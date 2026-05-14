// ============================================================
// Agent 入站处理器 - 连接 Agent Core 处理 Webhook 消息
// ============================================================
//
// 审批流程（挂起/恢复式，无重跑）：
//   1. Agent 遇到 tool-approval-request
//   2. 检查 permissions.json → allow/deny → 自动处理
//   3. 无规则匹配 → 保存当前 ModelMessage 执行现场 → 返回询问消息
//   4. 用户回复"同意" → 在执行现场追加 approval-response → 继续执行
//
// 核心优势：
//   - 不重跑 Agent，直接从挂起点续跑，无参数漂移风险
//   - 无 approvedToolCalls、generateApprovalKey 等匹配逻辑
//   - 无 replayMessages vs messages 双轨管理

import { convertToModelMessages, type UIMessage, type ModelMessage, type AssistantContent } from 'ai'
import { nanoid } from 'nanoid'
import type { InboundEvent } from './types'
import type { InboundEventResult, InboundEventHandler } from './inbound-processor'
import { createAgent, type AppContext } from '../../../api/app'
import { generateConversationTitle } from '../../../runtime/compaction'
import { extractMemoriesInBackground } from '../../../extensions/memory'
import { ConnectorRegistry } from '../registry'
import type { ConnectorModelConfig } from '../types'
import type { DataStore } from '../../../foundation/datastore/types'
import { checkPermissionRules } from '../../../extensions/permissions/rules'
import { buildApprovalAskMessageForRequests } from '../approval-handler'
import { DefaultConversationResolver, type ConversationResolver } from '../../../application/inbound-agent'
import {
  type SuspendedAgentState,
  getSuspendedState,
  setSuspendedState,
  clearSuspendedState,
  detectApprovalResponse,
} from '../approval-context'

// ============================================================
// stepsToMessageParts - 将 AI SDK steps 转换为 UIMessage parts
// ============================================================

/**
 * 将 AI SDK steps 数组转换为 UIMessage parts（reasoning + tool calls）
 *
 * 同时检查 step.content、step.toolCalls、step.toolResults 以兼容不同版本的 AI SDK
 */
function stepsToMessageParts(steps: unknown[]): UIMessage['parts'] {
  const reasoningTexts: string[] = []
  const callsByToolCallId: Record<string, { toolName: string; input: unknown; dynamic?: boolean }> = {}
  const resultsByToolCallId: Record<string, { output: unknown }> = {}
  const errorsByToolCallId: Record<string, { error: unknown }> = {}

  for (const step of steps) {
    const stepObj = step as Record<string, unknown>

    // 1. 从 step.content 中提取（AI SDK 通常把 LLM 输出放这里）
    const content = (stepObj.content ?? []) as unknown[]
    for (const item of content) {
      const itemObj = item as Record<string, unknown>

      if (itemObj.type === 'reasoning' && typeof itemObj.text === 'string') {
        reasoningTexts.push(itemObj.text)
      } else if (itemObj.type === 'reasoningText' && typeof itemObj.text === 'string') {
        reasoningTexts.push(itemObj.text)
      }

      const toolCallId = itemObj.toolCallId as string | undefined
      if (!toolCallId) continue

      if (itemObj.type === 'tool-call') {
        callsByToolCallId[toolCallId] = {
          toolName: itemObj.toolName as string,
          input: itemObj.input,
          dynamic: itemObj.dynamic as boolean | undefined,
        }
      } else if (itemObj.type === 'tool-result') {
        resultsByToolCallId[toolCallId] = { output: itemObj.result ?? itemObj.output }
      } else if (itemObj.type === 'tool-error') {
        errorsByToolCallId[toolCallId] = { error: itemObj.error }
      }
    }

    // 2. 从 step.toolResults 中提取（AI SDK 也把工具结果放这里）
    const toolResults = (stepObj.toolResults ?? []) as unknown[]
    for (const result of toolResults) {
      const r = result as Record<string, unknown>
      const toolCallId = r.toolCallId as string | undefined
      if (!toolCallId) continue
      if (r.isError) {
        errorsByToolCallId[toolCallId] = { error: r.result ?? r.error }
      } else {
        resultsByToolCallId[toolCallId] = { output: r.result ?? r.output }
      }
    }

    // 3. 从 step.toolCalls 中提取（部分版本把调用信息放这里）
    const toolCalls = (stepObj.toolCalls ?? []) as unknown[]
    for (const call of toolCalls) {
      const c = call as Record<string, unknown>
      const toolCallId = c.toolCallId as string | undefined
      if (!toolCallId || callsByToolCallId[toolCallId]) continue
      callsByToolCallId[toolCallId] = {
        toolName: c.toolName as string,
        input: c.input ?? c.args,
        dynamic: c.dynamic as boolean | undefined,
      }
    }
  }

  const parts: UIMessage['parts'] = []

  for (const text of reasoningTexts) {
    parts.push({ type: 'reasoning', text } as UIMessage['parts'][number])
  }

  for (const [toolCallId, call] of Object.entries(callsByToolCallId)) {
    const isError = toolCallId in errorsByToolCallId
    const hasResult = toolCallId in resultsByToolCallId

    if (!isError && !hasResult) {
      console.warn('[stepsToMessageParts] Skipping incomplete tool call:', toolCallId, call.toolName)
      continue
    }

    const base = call.dynamic
      ? { type: 'dynamic-tool' as const, toolName: call.toolName, toolCallId }
      : { type: `tool-${call.toolName}` as const, toolCallId }

    if (isError) {
      parts.push({
        ...base,
        input: call.input ?? null,
        output: null,
        state: 'output-error',
        errorText: String(errorsByToolCallId[toolCallId].error ?? 'Unknown error'),
      } as unknown as UIMessage['parts'][number])
    } else if (hasResult) {
      parts.push({
        ...base,
        input: call.input ?? null,
        output: resultsByToolCallId[toolCallId].output ?? null,
        state: 'output-available',
      } as UIMessage['parts'][number])
    }
  }

  return parts
}

// ============================================================
// sanitizeMessagesForConversion
// ============================================================

/**
 * 过滤 UIMessage 中不完整的工具调用（防止 convertToModelMessages 报错）
 */
function sanitizeMessagesForConversion(messages: UIMessage[]): UIMessage[] {
  return messages.map(msg => {
    if (msg.role !== 'assistant') return msg

    const sanitizedParts: UIMessage['parts'] = []
    for (const part of msg.parts) {
      if (part.type === 'text' || part.type === 'reasoning') {
        sanitizedParts.push(part)
        continue
      }
      const partObj = part as Record<string, unknown>
      const state = partObj.state as string | undefined
      if (state === 'output-available' || state === 'output-error') {
        sanitizedParts.push(part)
      } else if (state === 'input-available' || !state) {
        const toolName = (partObj as { toolName?: string }).toolName
        const toolCallId = (partObj as { toolCallId?: string }).toolCallId
        console.warn('[sanitizeMessagesForConversion] Skipping incomplete tool call:', toolCallId, toolName)
      } else {
        sanitizedParts.push(part)
      }
    }
    return { ...msg, parts: sanitizedParts }
  })
}

type ToolResultMessagePart = {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: unknown
}

function toToolResultOutput(value: unknown, isError: boolean): unknown {
  if (
    value &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as { type?: unknown }).type === 'string'
  ) {
    const type = (value as { type: string }).type
    if (
      type === 'text' ||
      type === 'json' ||
      type === 'execution-denied' ||
      type === 'error-text' ||
      type === 'error-json' ||
      type === 'content'
    ) {
      return value
    }
  }

  if (isError) {
    return typeof value === 'string'
      ? { type: 'error-text' as const, value }
      : { type: 'error-json' as const, value: value ?? null }
  }
  return { type: 'json' as const, value: value ?? null }
}

function collectExecutedToolResults(
  steps: unknown[],
  excludedToolCallIds: Set<string>,
): ToolResultMessagePart[] {
  const resultsByToolCallId = new Map<string, ToolResultMessagePart>()

  const addResult = (item: Record<string, unknown>) => {
    const toolCallId = item.toolCallId as string | undefined
    if (!toolCallId || excludedToolCallIds.has(toolCallId)) return

    const rawOutput = item.result ?? item.output ?? item.error
    const isError = item.isError === true || item.type === 'tool-error'
    resultsByToolCallId.set(toolCallId, {
      type: 'tool-result',
      toolCallId,
      toolName: (item.toolName as string | undefined) ?? '',
      output: toToolResultOutput(rawOutput, isError),
    })
  }

  for (const step of steps) {
    const stepObj = step as Record<string, unknown>

    for (const item of (stepObj.content ?? []) as unknown[]) {
      const itemObj = item as Record<string, unknown>
      if (itemObj.type === 'tool-result' || itemObj.type === 'tool-error') {
        addResult(itemObj)
      }
    }

    for (const item of (stepObj.toolResults ?? []) as unknown[]) {
      addResult(item as Record<string, unknown>)
    }
  }

  return [...resultsByToolCallId.values()]
}

// ============================================================
// Handler Config & Types
// ============================================================

export interface AgentHandlerConfig {
  registry: ConnectorRegistry
  userId?: string
  context: AppContext
  modules?: {
    mcps?: boolean
    skills?: boolean
    memory?: boolean
    connectors?: boolean
  }
  modelConfig?: ConnectorModelConfig
  conversationResolver?: ConversationResolver
}

interface AccumulatedState {
  allSteps: unknown[]
  responseText: string
  writtenFiles: Array<{ path: string; content: string }>
  /** 本 session 中用户已批准的工具名（跨 suspend/resume 传递，避免重复询问） */
  approvedTools: string[]
}

const RECENT_EVENT_TTL_MS = 10 * 60 * 1000
const recentEventIds = new Map<string, number>()
const conversationLocks = new Map<string, Promise<void>>()

const LOCAL_FILE_TOOLS = new Set(['read_file', 'write_file', 'edit_file'])
const LOCAL_FILE_APPROVAL_SCOPE = 'scope:local-file-tools'

function claimInboundEvent(eventId: string): boolean {
  const now = Date.now()
  for (const [id, timestamp] of recentEventIds.entries()) {
    if (now - timestamp > RECENT_EVENT_TTL_MS) {
      recentEventIds.delete(id)
    }
  }

  if (recentEventIds.has(eventId)) {
    return false
  }

  recentEventIds.set(eventId, now)
  return true
}

async function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const previous = conversationLocks.get(conversationId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const current = previous.catch(() => undefined).then(() => gate)
  conversationLocks.set(conversationId, current)

  await previous.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
    if (conversationLocks.get(conversationId) === current) {
      conversationLocks.delete(conversationId)
    }
  }
}

function approvalScopesForTool(toolName: string): string[] {
  return LOCAL_FILE_TOOLS.has(toolName)
    ? [toolName, LOCAL_FILE_APPROVAL_SCOPE]
    : [toolName]
}

function mergeApprovedTools(existing: string[], approvedToolName: string): string[] {
  return [...new Set([...existing, ...approvalScopesForTool(approvedToolName)])]
}

function isApprovedInSession(toolName: string, approvedTools: Set<string>): boolean {
  return approvedTools.has(toolName) || (LOCAL_FILE_TOOLS.has(toolName) && approvedTools.has(LOCAL_FILE_APPROVAL_SCOPE))
}

function summarizePendingToolNames(suspended: SuspendedAgentState): string {
  return [...new Set(suspended.pendingApprovals.map(item => item.toolName))].join(', ')
}

function mergeApprovedToolsFromSuspended(existing: string[], suspended: SuspendedAgentState): string[] {
  let merged = existing
  for (const approval of suspended.pendingApprovals) {
    merged = mergeApprovedTools(merged, approval.toolName)
  }
  return merged
}

// ============================================================
// AgentInboundHandler
// ============================================================

/**
 * Agent 入站处理器
 *
 * 使用"挂起/恢复"式审批流程，用户说"同意"时在原执行现场续跑，
 * 不重新调用 Agent 处理整个对话历史。
 */
export class AgentInboundHandler implements InboundEventHandler {
  private config: AgentHandlerConfig
  private conversationResolver: ConversationResolver

  constructor(config: AgentHandlerConfig) {
    this.config = config
    this.conversationResolver = config.conversationResolver ?? new DefaultConversationResolver()
  }

  async handle(event: InboundEvent): Promise<InboundEventResult> {
    if (!claimInboundEvent(event.id)) {
      console.warn('[AgentInboundHandler] Duplicate inbound event ignored:', event.id)
      return { success: true }
    }

    const startTime = Date.now()
    console.log('[AgentInboundHandler] ===== START HANDLING EVENT =====', {
      eventId: event.id,
      connectorId: event.connectorId,
      protocol: event.protocol,
      channelId: event.channel.id,
      senderId: event.sender.id,
      messageText: event.message.text?.slice(0, 50),
    })

    try {
      const conversationId = await this.findOrCreateConversation(event)
      console.log('[AgentInboundHandler] Conversation ID:', conversationId)

      return await withConversationLock(conversationId, async () => {
        const store = this.config.context.runtime.dataStore
        const existingMessages = store.messageStore.getMessagesByConversation(conversationId)
        const isFirstMessage = existingMessages.length === 0

        // ── 检测是否为审批回复 ──
        const messageText = event.message.text || ''
        const { isApprove, isDeny, isApprovalResponse } = detectApprovalResponse(messageText)
        const suspended = getSuspendedState(conversationId)
        const isResume = isApprovalResponse && !!suspended

        // ── 审批回复：拒绝 ──
        if (isResume && isDeny) {
          clearSuspendedState(conversationId)
          const denyMsg: UIMessage = {
            id: nanoid(),
            role: 'user',
            parts: [{ type: 'text', text: messageText }],
          }
          store.messageStore.saveMessages(conversationId, [...existingMessages, denyMsg])
          console.log('[AgentInboundHandler] User denied tool calls:', summarizePendingToolNames(suspended!))
          return {
            success: true,
            response: `已取消 ${summarizePendingToolNames(suspended!)} 操作`,
            conversationId,
          }
        }

        // ── 审批回复：同意 → 恢复执行现场 ──
        if (isResume && isApprove && suspended) {
          return this.resumeFromSuspended(event, conversationId, suspended, existingMessages, store, isFirstMessage)
        }

        // ── 正常消息：从用户消息开始 ──
        return this.startFreshRun(event, conversationId, existingMessages, store, isFirstMessage, startTime)
      })
    } catch (error) {
      console.error('[AgentInboundHandler] Error:', error)
      console.error('[AgentInboundHandler] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ── 从头开始执行 ──
  private async startFreshRun(
    event: InboundEvent,
    conversationId: string,
    existingMessages: UIMessage[],
    store: DataStore,
    isFirstMessage: boolean,
    startTime: number,
  ): Promise<InboundEventResult> {
    const userMessage = this.buildUserMessage(event)
    const uiMessagesForSave = [...existingMessages, userMessage]

    // Persist the inbound user turn before agent execution so suspend paths
    // can append approval prompts without overwriting the first message.
    store.messageStore.saveMessages(conversationId, uiMessagesForSave)

    const { agent, sessionState, adjustedMessages, model, dispose } = await this.createAgentInstance(
      conversationId,
      uiMessagesForSave,
    )

    const initialModelMessages = await convertToModelMessages(
      sanitizeMessagesForConversion(adjustedMessages ?? uiMessagesForSave)
    )

    return this.runAgentLoop(
      event,
      conversationId,
      store,
      agent,
      sessionState,
      model,
      dispose,
      initialModelMessages,
      uiMessagesForSave,
      { allSteps: [], responseText: '', writtenFiles: [], approvedTools: [] },
      isFirstMessage,
      startTime,
    )
  }

  // ── 恢复挂起的执行现场 ──
  private async resumeFromSuspended(
    event: InboundEvent,
    conversationId: string,
    suspended: SuspendedAgentState,
    existingMessages: UIMessage[],
    store: DataStore,
    isFirstMessage: boolean,
  ): Promise<InboundEventResult> {
    const startTime = Date.now()

    // 将审批回复存入 DB（供 Web UI 展示）
    const approvalReplyMsg: UIMessage = {
      id: nanoid(),
      role: 'user',
      parts: [{ type: 'text', text: event.message.text || '' }],
    }
    const uiMessagesForSave = [...existingMessages, approvalReplyMsg]
    store.messageStore.saveMessages(conversationId, uiMessagesForSave)

    // 在挂起点追加 approval-response，继续执行
    const resumeModelMessages: ModelMessage[] = [
      ...(suspended.pausedModelMessages as ModelMessage[]),
      {
        role: 'tool',
        content: suspended.pendingApprovals.map(approval => ({
          type: 'tool-approval-response' as const,
          approvalId: approval.approvalId,
          approved: true,
        })),
      } as ModelMessage,
    ]

    clearSuspendedState(conversationId)

    console.log('[AgentInboundHandler] Resuming from suspended state:', {
      conversationId,
      toolNames: suspended.pendingApprovals.map(item => item.toolName),
      pausedMessagesCount: suspended.pausedModelMessages.length,
    })

    const { agent, sessionState, model, dispose } = await this.createAgentInstance(
      conversationId,
      uiMessagesForSave,
    )

    return this.runAgentLoop(
      event,
      conversationId,
      store,
      agent,
      sessionState,
      model,
      dispose,
      resumeModelMessages,
      uiMessagesForSave,
      {
        allSteps: suspended.allSteps,
        responseText: suspended.responseText,
        writtenFiles: suspended.writtenFiles,
        // 将当前批准的工具名加入 session 集合；本地文件工具共享一次审批，避免 read/edit/write 连环询问。
        approvedTools: mergeApprovedToolsFromSuspended(suspended.approvedTools, suspended),
      },
      isFirstMessage,
      startTime,
    )
  }

  // ── 核心执行循环 ──
  private async runAgentLoop(
    event: InboundEvent,
    conversationId: string,
    store: DataStore,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agent: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessionState: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: any,
    dispose: () => Promise<void>,
    initialModelMessages: ModelMessage[],
    uiMessagesForSave: UIMessage[],
    accumulated: AccumulatedState,
    isFirstMessage: boolean,
    startTime: number,
  ): Promise<InboundEventResult> {
    let currentMessages = initialModelMessages
    let { allSteps, responseText, writtenFiles, approvedTools } = accumulated
    const sessionApprovedTools = new Set<string>(approvedTools)
    let finishReason = ''
    let lastStreamText = ''
    const MAX_ROUNDS = 10
    let round = 0

    while (round < MAX_ROUNDS) {
      round++

      // ── 流式执行（带 ECONNRESET 重试）──
      const MAX_RETRIES = 2
      let streamResult!: Awaited<ReturnType<typeof agent.stream>>
      for (let attempt = 0; ; attempt++) {
        try {
          streamResult = await agent.stream({ messages: currentMessages })
          break
        } catch (err) {
          const isRetriable =
            err instanceof Error &&
            (err.message === 'terminated' ||
              (err as NodeJS.ErrnoException).code === 'ECONNRESET' ||
              ((err as { cause?: unknown }).cause instanceof Error &&
                ((err as { cause?: NodeJS.ErrnoException }).cause as NodeJS.ErrnoException).code === 'ECONNRESET'))
          if (isRetriable && attempt < MAX_RETRIES) {
            const delay = 1500 * (attempt + 1)
            console.warn(`[AgentInboundHandler] Stream error, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES}):`, err instanceof Error ? err.message : err)
            await new Promise(r => setTimeout(r, delay))
            continue
          }
          throw err
        }
      }

      // ── 消费流 ──
      const approvalRequests: Array<{
        approvalId: string
        toolCallId: string
        toolName: string
        input: Record<string, unknown>
      }> = []

      const stepContent: Array<{
        type: string
        toolCallId?: string
        toolName?: string
        input?: Record<string, unknown>
        text?: string
      }> = []

      for await (const part of streamResult.fullStream) {
        if (part.type === 'text-delta') {
          responseText += part.text
        }

        if (part.type === 'reasoning' && typeof (part as { text?: string }).text === 'string') {
          stepContent.push({ type: 'reasoning', text: (part as { text: string }).text })
        }

        if (part.type === 'tool-call') {
          const tc = part as { type: 'tool-call'; toolCallId: string; toolName: string; input: Record<string, unknown> }
          stepContent.push({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
          if (tc.toolName === 'write_file' && tc.input?.content && tc.input?.filePath) {
            writtenFiles.push({ path: tc.input.filePath as string, content: tc.input.content as string })
          }
        }

        if (part.type === 'tool-approval-request') {
          const ap = part as unknown as {
            type: 'tool-approval-request'
            approvalId: string
            toolCall: { toolCallId: string; toolName: string; input: Record<string, unknown> }
          }
          console.log('[AgentInboundHandler] Tool approval request:', {
            approvalId: ap.approvalId,
            toolName: ap.toolCall.toolName,
            toolCallId: ap.toolCall.toolCallId,
          })
          approvalRequests.push({
            approvalId: ap.approvalId,
            toolCallId: ap.toolCall.toolCallId,
            toolName: ap.toolCall.toolName,
            input: ap.toolCall.input,
          })
        }
      }

      finishReason = await streamResult.finishReason
      const steps = await streamResult.steps
      allSteps = [...allSteps, ...steps]
      lastStreamText = await streamResult.text || ''

      console.log(`[AgentInboundHandler] Stream result (round ${round}):`, {
        stepsCount: steps.length,
        textLength: responseText.length,
        finishReason,
        approvalRequests: approvalRequests.length,
        toolCalls: stepContent.filter(c => c.type === 'tool-call').map(c => c.toolName),
      })

      // ── 无审批请求：完成 ──
      if (approvalRequests.length === 0) break

      // ── 处理审批请求 ──
      const autoApprovalContent: Array<{
        type: 'tool-approval-response'
        approvalId: string
        approved: boolean
        reason?: string
      }> = []
      const pendingApprovalRequests: typeof approvalRequests = []

      for (const req of approvalRequests) {
        const rule = checkPermissionRules(req.toolName, req.input)

        if (rule?.behavior === 'allow') {
          console.log('[AgentInboundHandler] Auto-approved by permissions.json:', req.toolName)
          autoApprovalContent.push({ type: 'tool-approval-response', approvalId: req.approvalId, approved: true })
        } else if (rule?.behavior === 'deny') {
          console.log('[AgentInboundHandler] Denied by permissions.json:', req.toolName)
          autoApprovalContent.push({ type: 'tool-approval-response', approvalId: req.approvalId, approved: false, reason: `操作被权限规则拒绝: ${rule.pattern}` })
        } else if (isApprovedInSession(req.toolName, sessionApprovedTools)) {
          console.log('[AgentInboundHandler] Already approved by user in this session:', req.toolName)
          autoApprovalContent.push({ type: 'tool-approval-response', approvalId: req.approvalId, approved: true })
        } else {
          pendingApprovalRequests.push(req)
        }
      }

      if (pendingApprovalRequests.length > 0) {
        const approvalAskText = buildApprovalAskMessageForRequests(
          pendingApprovalRequests.map(req => ({
            toolName: req.toolName,
            input: req.input,
          }))
        )
        const approvalAskMsgId = `approval-ask-${nanoid()}`

        // 构建挂起点的 ModelMessages
        // 包含：assistant(tool-call + tool-approval-request) + tool(已执行的 tool-result / 已自动处理的审批结果)
        // AI SDK v6 恢复审批时会从历史 assistant content 中按 approvalId 查 request。
        const toolCallParts = stepContent.filter(c => c.type === 'tool-call')
        const approvalRequestParts = approvalRequests.map(r => ({
          type: 'tool-approval-request' as const,
          approvalId: r.approvalId,
          toolCallId: r.toolCallId,
        }))

        const pendingToolCallIds = new Set(approvalRequests.map(r => r.toolCallId))
        const executedToolResults = collectExecutedToolResults(steps, pendingToolCallIds)

        const pausedModelMessages: ModelMessage[] = [
          ...currentMessages,
          {
            role: 'assistant',
            content: [
              ...toolCallParts.map(c => ({
                type: 'tool-call' as const,
                toolCallId: c.toolCallId!,
                toolName: c.toolName!,
                input: c.input ?? {},
              })),
              ...approvalRequestParts,
            ],
          } as ModelMessage,
        ]

        if (executedToolResults.length > 0) {
          pausedModelMessages.push({
            role: 'tool',
            content: executedToolResults,
          } as unknown as ModelMessage)
        }

        if (autoApprovalContent.length > 0) {
          pausedModelMessages.push({
            role: 'tool',
            content: autoApprovalContent,
          } as ModelMessage)
        }

        setSuspendedState(conversationId, {
          conversationId,
          connectorEventId: event.id,
          replyAddress: event.replyAddress,
          pausedModelMessages,
          pendingApprovals: pendingApprovalRequests.map(req => ({
            approvalId: req.approvalId,
            toolCallId: req.toolCallId,
            toolName: req.toolName,
            toolInput: req.input,
          })),
          allSteps,
          responseText,
          writtenFiles,
          approvedTools: [...sessionApprovedTools],
          approvalAskMessageId: approvalAskMsgId,
          createdAt: Date.now(),
        })

        // 将审批询问保存为 assistant 消息（供 Web UI 展示）
        const approvalAskMsg: UIMessage = {
          id: approvalAskMsgId,
          role: 'assistant',
          parts: [{ type: 'text', text: approvalAskText }],
        }
        store.messageStore.saveMessages(conversationId, [...uiMessagesForSave, approvalAskMsg])

        await dispose().catch((err: Error) => console.error('[Agent Dispose] Error:', err))

        return {
          success: true,
          response: approvalAskText,
          conversationId,
        }
      }

      // ── 全部自动审批通过：追加审批响应，继续下一轮 ──
      const assistantContent: AssistantContent = stepContent
        .filter(c => c.type === 'tool-call' || c.type === 'reasoning')
        .map(c =>
          c.type === 'tool-call'
            ? { type: 'tool-call' as const, toolCallId: c.toolCallId!, toolName: c.toolName!, input: c.input ?? {} }
            : { type: 'reasoning' as const, text: c.text ?? '' }
        )
      assistantContent.push(...approvalRequests.map(r => ({
        type: 'tool-approval-request' as const,
        approvalId: r.approvalId,
        toolCallId: r.toolCallId,
      })))

      const executedToolResults = collectExecutedToolResults(
        steps,
        new Set(approvalRequests.map(r => r.toolCallId)),
      )
      const toolContent = [...executedToolResults, ...autoApprovalContent]

      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant',
          content: assistantContent,
        } as ModelMessage,
        ...(toolContent.length > 0
          ? [{
              role: 'tool',
              content: toolContent,
            } as unknown as ModelMessage]
          : []),
      ]

      console.log('[AgentInboundHandler] Resuming with auto-approval responses:', autoApprovalContent.length)
    }

    if (round >= MAX_ROUNDS) {
      console.warn('[AgentInboundHandler] Max rounds reached, stopping loop')
    }

    // ── 构建最终回复 ──
    if (!responseText) responseText = lastStreamText

    if (writtenFiles.length > 0) {
      const fileSection = writtenFiles.map(f => `📄 **${f.path}**\n\n${f.content}`).join('\n\n---\n\n')
      responseText = responseText.trim() ? `${responseText}\n\n${fileSection}` : fileSection
    }

    let finalResponse = this.filterSystemContent(responseText)
    if (!finalResponse || finalResponse.trim().length === 0) {
      finalResponse = lastStreamText || '任务已完成'
    }

    // ── 保存对话历史 ──
    const messageParts = stepsToMessageParts(allSteps)
    const assistantMessage: UIMessage = {
      id: nanoid(),
      role: 'assistant',
      parts: [...messageParts, { type: 'text', text: finalResponse }],
    }

    const messagesToSave = this.filterInjectedMessages(uiMessagesForSave)
    const finalMessages = [...messagesToSave, assistantMessage]
    store.messageStore.saveMessages(conversationId, finalMessages)

    // ── 后台：记忆提取 / 标题生成 / 成本持久化 ──
    const cwd = this.config.context.cwd
    setImmediate(() => {
      const userId = this.config.userId || event.sender.id
      const memoryLimits = this.config.context.behavior?.memory
      extractMemoriesInBackground(finalMessages, userId, conversationId, model, cwd, {
        maxLines: memoryLimits?.entrypointMaxLines,
        maxBytes: memoryLimits?.entrypointMaxBytes,
      }).catch(
        (err: Error) => console.error('[Memory Extraction] Error:', err)
      )
      if (isFirstMessage) {
        generateConversationTitle(messagesToSave, model)
          .then((title: string) => {
            store.conversationStore.updateConversationTitle(conversationId, title)
          })
          .catch((err: Error) => console.error('[Title Generation] Error:', err))
      }
      sessionState.costTracker.persistToDB().catch((err: Error) => console.error('[Cost Persist] Error:', err))
      dispose().catch((err: Error) => console.error('[Agent Dispose] Error:', err))
    })

    console.log('[AgentInboundHandler] ===== COMPLETE =====', {
      responseLength: finalResponse.length,
      conversationId,
      durationMs: Date.now() - startTime,
    })

    return {
      success: true,
      response: finalResponse,
      conversationId,
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private async createAgentInstance(conversationId: string, messages: UIMessage[]) {
    const modelConfig = this.config.modelConfig
    if (!modelConfig) throw new Error('[AgentInboundHandler] modelConfig is required')

    return createAgent({
      context: this.config.context,
      conversationId,
      messages,
      userId: this.config.userId || 'connector',
      model: {
        apiKey: modelConfig.apiKey,
        baseURL: modelConfig.baseURL,
        modelName: modelConfig.modelName,
        includeUsage: modelConfig.includeUsage ?? true,
      },
      conversationMeta: {
        isNewConversation: messages.length <= 1,
        conversationStartTime: Date.now(),
      },
      modules: {
        mcps: this.config.modules?.mcps ?? true,
        skills: this.config.modules?.skills ?? true,
        memory: this.config.modules?.memory ?? true,
        connectors: this.config.modules?.connectors ?? false,
      },
    })
  }

  private filterSystemContent(response: string): string {
    if (!response) return ''
    let filtered = response.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    filtered = filtered.replace(/The following skills are available[\s\S]*?(?=\n\n[A-Z]|\n\n\n|$)/g, '')
    filtered = filtered.replace(/New skills are now available[\s\S]*?(?=\n\n[A-Z]|\n\n\n|$)/g, '')
    return filtered.trim()
  }

  private filterInjectedMessages(messages: UIMessage[]): UIMessage[] {
    return messages.filter(msg => {
      if (msg.id.startsWith('skill-listing-')) return false
      const text = this.extractMessageText(msg)
      if (text.includes('<system-reminder>')) return false
      if (text.startsWith('The following skills are available')) return false
      if (text.startsWith('New skills are now available')) return false
      return true
    })
  }

  private extractMessageText(msg: UIMessage): string {
    return msg.parts
      .filter(p => p.type === 'text')
      .map(p => (p as { type: 'text'; text: string }).text)
      .join(' ')
  }

  private async findOrCreateConversation(event: InboundEvent): Promise<string> {
    const conversationId = await this.conversationResolver.resolve(event)
    const store = this.config.context.runtime.dataStore

    const existing = store.conversationStore.getConversation(conversationId)
    if (!existing) {
      const title = `${event.connectorId} - ${event.sender.name || event.sender.id}`
      store.conversationStore.createConversation(conversationId, title)
    }

    return conversationId
  }

  private buildUserMessage(event: InboundEvent): UIMessage {
    return {
      id: nanoid(),
      role: 'user',
      parts: [{ type: 'text', text: event.message.text || '' }],
    }
  }
}

export function createAgentInboundHandler(config: AgentHandlerConfig): AgentInboundHandler {
  return new AgentInboundHandler(config)
}
