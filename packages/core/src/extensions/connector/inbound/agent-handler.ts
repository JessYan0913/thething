// ============================================================
// Agent 入站处理器 - 连接 Agent Core 处理 Webhook 消息
// ============================================================
//
// 处理状态指示器（如飞书的"正在思考"表情）由 InboundEventProcessor
// 根据 connector YAML 配置自动处理，此处不再硬编码

import { convertToModelMessages, type UIMessage, type ModelMessage } from 'ai'
import { nanoid } from 'nanoid'
import type { InboundMessageEvent } from '../types'
import type { InboundEventResult, InboundEventHandler } from './inbound-processor'
import { createAgent, type AppContext } from '../../../api/app'
import { generateConversationTitle } from '../../../runtime/compaction'
import { extractMemoriesInBackground } from '../../../extensions/memory'
import { ConnectorRegistry } from '../registry'
import type { ConnectorModelConfig } from '../types'
import { checkPermissionRules } from '../../../extensions/permissions/rules'
import { buildApprovalAskMessage } from '../approval-handler'
import {
  isToolCallApproved,
  markToolCallApproved,
  setPendingApproval,
  getPendingApproval,
  clearPendingApproval,
} from '../approval-context'

/**
 * Convert ContentParts from result.steps into UIMessage.parts format,
 * including reasoning, tool-call/tool-result/tool-error items.
 *
 * 注意：只保存完整的工具调用（有结果或错误的），不保存未执行的调用
 * 这样可以避免 convertToModelMessages 报 MissingToolResultsError
 *
 * 参考 AI SDK 的 steps 结构，将执行过程转换为 UI 可展示的消息 parts
 */
function stepsToMessageParts(steps: unknown[]): UIMessage['parts'] {
  const reasoningTexts: string[] = []
  const callsByToolCallId: Record<string, { toolName: string; input: unknown; dynamic?: boolean }> = {}
  const resultsByToolCallId: Record<string, { output: unknown }> = {}
  const errorsByToolCallId: Record<string, { error: unknown }> = {}

  for (const step of steps) {
    const stepObj = step as Record<string, unknown>
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
        resultsByToolCallId[toolCallId] = { output: itemObj.output }
      } else if (itemObj.type === 'tool-error') {
        errorsByToolCallId[toolCallId] = { error: itemObj.error }
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
        state: 'output-error',
        errorText:
          typeof errorsByToolCallId[toolCallId].error === 'string'
            ? errorsByToolCallId[toolCallId].error
            : String(errorsByToolCallId[toolCallId].error ?? 'Tool execution failed'),
      } as UIMessage['parts'][number])
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

/**
 * 过滤消息中不完整的工具调用
 *
 * convertToModelMessages 要求工具调用必须有对应的工具结果
 * 如果历史消息中有未执行的工具调用（权限被拒绝等），会导致转换失败
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

/**
 * Agent 入站处理器配置
 */
export interface AgentHandlerConfig {
  registry: ConnectorRegistry
  userId?: string
  /** AppContext（必须提供，用于 createAgent） */
  context: AppContext
  /** 模块启用配置（默认全部启用） */
  modules?: {
    /** MCP 工具（默认 true） */
    mcps?: boolean
    /** 技能系统（默认 true） */
    skills?: boolean
    /** 记忆系统（默认 true） */
    memory?: boolean
    /** Connector 工具（默认 false，避免循环调用） */
    connectors?: boolean
  }
  /**
   * 模型配置（可选）
   * 如果提供，将使用此配置而非从环境变量读取
   */
  modelConfig?: ConnectorModelConfig
}

/**
 * Agent 入站处理器
 * 接收 Webhook 消息，触发 Agent 对话，返回回复
 *
 * 权限征询流程（纯内存，无数据库）：
 *   1. agent 执行遇到 tool-approval-request
 *   2. 检查 permissions.json → allow/deny → 自动处理
 *   3. 无规则匹配 → setPendingApproval() → 返回询问消息给用户
 *   4. 用户回复"同意" → getPendingApproval() → markToolCallApproved() → 重跑 agent
 *   5. agent 重跑 → isToolCallApproved() → 自动批准 → 工具正常执行
 */
export class AgentInboundHandler implements InboundEventHandler {
  private config: AgentHandlerConfig

  constructor(config: AgentHandlerConfig) {
    this.config = config
  }

  async handle(event: InboundMessageEvent): Promise<InboundEventResult> {
    const startTime = Date.now()
    console.log('[AgentInboundHandler] ===== START HANDLING EVENT =====', {
      eventId: event.event_id,
      connectorType: event.connector_type,
      channelId: event.channel_id,
      senderId: event.sender.id,
      messageText: event.message.text?.slice(0, 50),
    })

    try {
      // 1. 根据 channel_id 查找或创建对话
      const conversationId = await this.findOrCreateConversation(event)
      console.log('[AgentInboundHandler] Conversation ID:', conversationId)

      // 2. 获取对话历史
      const store = this.config.context.runtime.dataStore
      const existingMessages = store.messageStore.getMessagesByConversation(conversationId)
      const isFirstMessage = existingMessages.length === 0

      // 3. 检测当前消息是否为审批响应
      // 审批状态完全由内存 approval-context 管理，不依赖数据库
      // 只有当内存中确实存在 pending approval 时，才将关键词消息视为审批响应
      const approvalKeywords = ['同意', '允许', '批准', '确认', 'ok', 'yes', '好', '行', '可以', '是的', '没问题']
      const denyKeywords = ['拒绝', '不同意', '禁止', '取消', 'no', '不行', '不要', 'deny']
      const messageText = event.message.text?.toLowerCase().trim() || ''
      const isApproveKeyword = approvalKeywords.some(k => messageText.includes(k))
      const isDenyKeyword = denyKeywords.some(k => messageText.includes(k))

      const pendingApproval = getPendingApproval(conversationId)
      const isApprovalResponse = (isApproveKeyword || isDenyKeyword) && pendingApproval !== null

      // 4. 构建本次执行的消息列表
      let userMessage: UIMessage
      let messages: UIMessage[]

      if (isApprovalResponse && pendingApproval && existingMessages.length > 0) {
        if (isApproveKeyword) {
          // 用户同意：标记工具为已批准，清除 pending 状态
          markToolCallApproved(conversationId, pendingApproval.toolName, pendingApproval.input)
          clearPendingApproval(conversationId)
          console.log('[AgentInboundHandler] User approved tool call:', {
            conversationId,
            toolName: pendingApproval.toolName,
          })
        } else {
          // 用户拒绝：清除 pending 状态，直接返回
          clearPendingApproval(conversationId)
          console.log('[AgentInboundHandler] User denied tool call:', pendingApproval.toolName)
          return {
            success: true,
            response: `已取消 ${pendingApproval.toolName} 操作`,
            conversationId,
          }
        }

        // 不将"同意"/"拒绝"消息存入历史，使用现有历史重跑 agent
        console.log('[AgentInboundHandler] Approval response detected, replaying with existing messages')
        messages = existingMessages
      } else {
        // 正常消息：构建并追加新的用户消息
        userMessage = this.buildUserMessage(event)
        messages = [...existingMessages, userMessage]
      }

      // 5. 获取用户 ID
      const userId = this.config.userId || event.sender.id

      // 6. 创建 Agent
      const modelConfig = this.config.modelConfig
      if (!modelConfig) {
        throw new Error('[AgentInboundHandler] modelConfig is required but not provided')
      }

      const { agent, sessionState, adjustedMessages, model, dispose } = await createAgent({
        context: this.config.context,
        conversationId,
        messages,
        userId,
        model: {
          apiKey: modelConfig.apiKey,
          baseURL: modelConfig.baseURL,
          modelName: modelConfig.modelName,
          includeUsage: modelConfig.includeUsage ?? true,
        },
        conversationMeta: {
          isNewConversation: isFirstMessage,
          conversationStartTime: Date.now(),
        },
        modules: {
          mcps: this.config.modules?.mcps ?? true,
          skills: this.config.modules?.skills ?? true,
          memory: this.config.modules?.memory ?? true,
          connectors: this.config.modules?.connectors ?? false,
        },
      })

      // 7. 执行 Agent（流式，支持审批循环）
      const messagesToProcess = adjustedMessages ?? messages
      const sanitizedMessages = sanitizeMessagesForConversion(messagesToProcess)
      let currentMessages = await convertToModelMessages(sanitizedMessages)

      let responseText = ''
      const writtenFiles: Array<{ path: string; content: string }> = []
      let steps: unknown[] = []
      let finishReason: string = ''
      const maxApprovalRounds = 10
      let approvalRound = 0
      let lastStreamText: string = ''

      while (approvalRound < maxApprovalRounds) {
        approvalRound++

        const streamResult = await agent.stream({
          messages: currentMessages,
        })

        const approvalRequests: Array<{
          approvalId: string
          toolCallId: string
          toolName: string
          input: Record<string, unknown>
        }> = []

        for await (const part of streamResult.fullStream) {
          if (part.type === 'text-delta') {
            responseText += part.text
          }

          if (part.type === 'tool-call') {
            const toolCallPart = part as {
              type: 'tool-call'
              toolCallId: string
              toolName: string
              input: Record<string, unknown>
            }
            if (
              toolCallPart.toolName === 'write_file' &&
              toolCallPart.input?.content &&
              toolCallPart.input?.filePath
            ) {
              writtenFiles.push({
                path: toolCallPart.input.filePath as string,
                content: toolCallPart.input.content as string,
              })
            }
          }

          if (part.type === 'tool-approval-request') {
            const approvalPart = part as unknown as {
              type: 'tool-approval-request'
              approvalId: string
              toolCall: {
                toolCallId: string
                toolName: string
                input: Record<string, unknown>
              }
            }
            console.log('[AgentInboundHandler] Tool approval request:', {
              approvalId: approvalPart.approvalId,
              toolName: approvalPart.toolCall.toolName,
              toolCallId: approvalPart.toolCall.toolCallId,
            })
            approvalRequests.push({
              approvalId: approvalPart.approvalId,
              toolCallId: approvalPart.toolCall.toolCallId,
              toolName: approvalPart.toolCall.toolName,
              input: approvalPart.toolCall.input,
            })
          }
        }

        finishReason = await streamResult.finishReason
        steps = await streamResult.steps
        lastStreamText = await streamResult.text || ''

        console.log('[AgentInboundHandler] Stream result (round ' + approvalRound + '):', {
          stepsCount: steps.length,
          textLength: responseText.length,
          finishReason,
          approvalRequests: approvalRequests.length,
          toolCalls: steps.flatMap((step: unknown) => {
            const stepObj = step as Record<string, unknown>
            return ((stepObj.content ?? []) as unknown[])
              .filter((c: unknown) => (c as Record<string, unknown>).type === 'tool-call')
              .map((c: unknown) => (c as Record<string, unknown>).toolName)
          }),
        })

        if (approvalRequests.length === 0) {
          break
        }

        // 从 steps 中提取 assistant 内容（tool-call + reasoning）
        const lastStep = steps[steps.length - 1] as Record<string, unknown> | undefined
        const stepContent = (lastStep?.content ?? []) as Array<{
          type: string
          toolCallId?: string
          toolName?: string
          input?: Record<string, unknown>
          text?: string
        }>

        const toolCallParts: Array<{
          type: 'tool-call'
          toolCallId: string
          toolName: string
          input: Record<string, unknown>
        }> = []

        const reasoningParts: Array<{
          type: 'reasoning'
          text: string
        }> = []

        for (const part of stepContent) {
          if (part.type === 'tool-call' && part.toolCallId && part.toolName) {
            toolCallParts.push({
              type: 'tool-call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input ?? {},
            })
          } else if (part.type === 'reasoning' && part.text) {
            reasoningParts.push({
              type: 'reasoning',
              text: part.text,
            })
          }
        }

        const approvalRequestParts: Array<{
          type: 'tool-approval-request'
          approvalId: string
          toolCallId: string
        }> = approvalRequests.map(req => ({
          type: 'tool-approval-request',
          approvalId: req.approvalId,
          toolCallId: req.toolCallId,
        }))

        const assistantContent = [
          ...reasoningParts,
          ...toolCallParts,
          ...approvalRequestParts,
        ]

        const toolApprovalContent: Array<{
          type: 'tool-approval-response'
          approvalId: string
          approved: boolean
          reason?: string
        }> = []

        let needsUserApproval = false

        for (const req of approvalRequests) {
          const matchedRule = checkPermissionRules(req.toolName, req.input)

          if (matchedRule?.behavior === 'allow') {
            console.log('[AgentInboundHandler] Auto-approved by permissions.json:', {
              toolName: req.toolName,
              pattern: matchedRule.pattern,
            })
            toolApprovalContent.push({
              type: 'tool-approval-response',
              approvalId: req.approvalId,
              approved: true,
            })
          } else if (matchedRule?.behavior === 'deny') {
            console.log('[AgentInboundHandler] Denied by permissions.json:', {
              toolName: req.toolName,
              pattern: matchedRule.pattern,
            })
            toolApprovalContent.push({
              type: 'tool-approval-response',
              approvalId: req.approvalId,
              approved: false,
              reason: `操作被权限规则拒绝: ${matchedRule.pattern}`,
            })
          } else if (isToolCallApproved(conversationId, req.toolName, req.input)) {
            // 用户已在本次会话中审批过此工具（重跑场景）
            console.log('[AgentInboundHandler] Already approved by user:', req.toolName)
            toolApprovalContent.push({
              type: 'tool-approval-response',
              approvalId: req.approvalId,
              approved: true,
            })
          } else {
            // 无权限规则且未批准：向用户征询确认
            console.log('[AgentInboundHandler] Needs user approval:', {
              toolName: req.toolName,
              input: req.input,
            })

            // 写入内存 pending 状态（不用数据库）
            setPendingApproval(conversationId, {
              toolName: req.toolName,
              input: req.input,
              connectorType: event.connector_type,
              channelId: event.channel_id,
              createdAt: Date.now(),
            })

            // 保存用户消息到历史，确保用户回复"同意"后 agent 重跑时能找到原始任务
            const userMessageToSave: UIMessage = {
              id: nanoid(),
              role: 'user',
              parts: [{ type: 'text', text: event.message.text || '' }],
            }
            store.messageStore.saveMessages(conversationId, [...existingMessages, userMessageToSave])

            console.log('[AgentInboundHandler] Saved user message and set pending approval for:', req.toolName)

            needsUserApproval = true
            break
          }
        }

        if (needsUserApproval) {
          // 中断循环，向用户发送询问消息
          const pendingInfo = getPendingApproval(conversationId)
          return {
            success: true,
            response: buildApprovalAskMessage(
              pendingInfo?.toolName ?? approvalRequests[0].toolName,
              pendingInfo?.input ?? approvalRequests[0].input
            ),
            conversationId,
          }
        }

        // 将 assistant 消息和审批响应追加到消息列表，继续循环
        currentMessages.push({
          role: 'assistant',
          content: assistantContent,
        } as ModelMessage)

        currentMessages.push({
          role: 'tool',
          content: toolApprovalContent,
        } as ModelMessage)

        console.log('[AgentInboundHandler] Resuming with approval responses:', toolApprovalContent.length)
      }

      if (approvalRound >= maxApprovalRounds) {
        console.warn('[AgentInboundHandler] Max approval rounds reached, stopping loop')
      }

      // 8. 提取响应文本
      if (!responseText) {
        responseText = lastStreamText
      }

      if (writtenFiles.length > 0) {
        const fileSection = writtenFiles.map((f) => `📄 **${f.path}**\n\n${f.content}`).join('\n\n---\n\n')
        responseText = responseText.trim() ? `${responseText}\n\n${fileSection}` : fileSection
      }

      let finalResponse = this.filterSystemContent(responseText)

      if (!finalResponse || finalResponse.trim().length === 0) {
        finalResponse = lastStreamText || '任务已完成'
      }

      // 9. 构建助手消息（包含工具调用过程）
      const messageParts = stepsToMessageParts(steps)
      const assistantMessage: UIMessage = {
        id: nanoid(),
        role: 'assistant',
        parts: [...messageParts, { type: 'text', text: finalResponse }],
      }

      // 10. 保存对话历史（过滤掉系统注入的消息）
      const messagesToSave = this.filterInjectedMessages(messages)
      const finalMessages = [...messagesToSave, assistantMessage]
      store.messageStore.saveMessages(conversationId, finalMessages)

      // 11. 后台处理
      const cwd = this.config.context.cwd

      setImmediate(() => {
        extractMemoriesInBackground(finalMessages, userId, conversationId, model, cwd).catch((err: Error) =>
          console.error('[Memory Extraction] Error:', err)
        )

        if (isFirstMessage) {
          generateConversationTitle(messagesToSave, model)
            .then((title: string) => {
              store.conversationStore.updateConversationTitle(conversationId, title)
            })
            .catch((err: Error) => console.error('[Title Generation] Error:', err))
        }

        sessionState.costTracker.persistToDB().catch((err: Error) =>
          console.error('[Cost Persist] Error:', err)
        )

        dispose().catch((err: Error) =>
          console.error('[Agent Dispose] Error:', err)
        )
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
    } catch (error) {
      console.error('[AgentInboundHandler] Error:', error)
      console.error('[AgentInboundHandler] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 过滤系统信息内容
   */
  private filterSystemContent(response: string): string {
    if (!response) return ''

    let filtered = response.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    filtered = filtered.replace(/The following skills are available[\s\S]*?(?=\n\n[A-Z]|\n\n\n|$)/g, '')
    filtered = filtered.replace(/New skills are now available[\s\S]*?(?=\n\n[A-Z]|\n\n\n|$)/g, '')
    filtered = filtered.trim()

    return filtered
  }

  /**
   * 过滤系统注入的消息
   */
  private filterInjectedMessages(messages: UIMessage[]): UIMessage[] {
    return messages.filter(msg => {
      if (msg.id.startsWith('skill-listing-')) {
        return false
      }

      const text = this.extractMessageText(msg)
      if (text.includes('<system-reminder>')) {
        return false
      }

      if (
        text.startsWith('The following skills are available') ||
        text.startsWith('New skills are now available')
      ) {
        return false
      }

      return true
    })
  }

  /**
   * 提取消息文本内容
   */
  private extractMessageText(msg: UIMessage): string {
    const textParts = msg.parts
      .filter(p => p.type === 'text')
      .map(p => (p as { type: 'text'; text: string }).text)
    return textParts.join(' ')
  }

  /**
   * 根据 channel_id 查找或创建对话
   */
  private async findOrCreateConversation(event: InboundMessageEvent): Promise<string> {
    const conversationId = `${event.connector_type}_${event.channel_id}`
    const store = this.config.context.runtime.dataStore

    const existing = store.conversationStore.getConversation(conversationId)
    if (existing) {
      return conversationId
    }

    const title = `${event.connector_type} - ${event.sender.name || event.sender.id}`
    store.conversationStore.createConversation(conversationId, title)

    return conversationId
  }

  /**
   * 构建用户消息
   */
  private buildUserMessage(event: InboundMessageEvent): UIMessage {
    return {
      id: nanoid(),
      role: 'user',
      parts: [
        {
          type: 'text',
          text: event.message.text || '',
        },
      ],
    }
  }
}

/**
 * 创建 Agent 入站处理器
 */
export function createAgentInboundHandler(config: AgentHandlerConfig): AgentInboundHandler {
  return new AgentInboundHandler(config)
}
