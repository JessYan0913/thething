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

      // 提取推理内容
      if (itemObj.type === 'reasoning' && typeof itemObj.text === 'string') {
        reasoningTexts.push(itemObj.text)
      } else if (itemObj.type === 'reasoningText' && typeof itemObj.text === 'string') {
        reasoningTexts.push(itemObj.text)
      }

      const toolCallId = itemObj.toolCallId as string | undefined
      if (!toolCallId) continue

      // 提取工具调用
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

  // Add reasoning parts first (shown as collapsible "Thought for X seconds" in UI)
  for (const text of reasoningTexts) {
    parts.push({ type: 'reasoning', text } as UIMessage['parts'][number])
  }

  // Add tool parts - 只添加有结果或错误的完整工具调用
  // 未执行的调用（没有结果/错误）会导致 convertToModelMessages 报错
  for (const [toolCallId, call] of Object.entries(callsByToolCallId)) {
    const isError = toolCallId in errorsByToolCallId
    const hasResult = toolCallId in resultsByToolCallId

    // 跳过未执行的工具调用（没有结果也没有错误）
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
 *
 * @param messages - 原始消息列表
 * @returns 过滤后的消息列表（移除不完整的工具调用）
 */
function sanitizeMessagesForConversion(messages: UIMessage[]): UIMessage[] {
  return messages.map(msg => {
    if (msg.role !== 'assistant') return msg

    const sanitizedParts: UIMessage['parts'] = []

    for (const part of msg.parts) {
      // 只保留文本和推理内容
      if (part.type === 'text' || part.type === 'reasoning') {
        sanitizedParts.push(part)
        continue
      }

      // 对于工具调用，检查是否有完整的结果
      const partObj = part as Record<string, unknown>
      const state = partObj.state as string | undefined

      // 只保留有输出结果的工具调用
      // 'output-available' 和 'output-error' 是完整的
      // 'input-available' 是不完整的（没有执行）
      if (state === 'output-available' || state === 'output-error') {
        sanitizedParts.push(part)
      } else if (state === 'input-available' || !state) {
        // 不完整的工具调用，跳过
        const toolName = (partObj as { toolName?: string }).toolName
        const toolCallId = (partObj as { toolCallId?: string }).toolCallId
        console.warn('[sanitizeMessagesForConversion] Skipping incomplete tool call:', toolCallId, toolName)
      } else {
        // 其他未知状态，保留
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
 * 注意：处理状态指示器由 InboundEventProcessor 自动处理，
 * 根据 connector YAML 中的 inbound.processing_indicator 配置
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

      // 2. 构建用户消息
      const userMessage = this.buildUserMessage(event)

      // 3. 获取对话历史
      const store = this.config.context.runtime.dataStore
      const existingMessages = store.messageStore.getMessagesByConversation(conversationId)
      const isFirstMessage = existingMessages.length === 0
      const messages: UIMessage[] = [...existingMessages, userMessage]

      // 4. 获取用户 ID
      const userId = this.config.userId || event.sender.id

      // 5. 创建 Agent（复用 HTTP Chat 的完整流程）
      // 权限规则统一由 permissions.json 控制，与 UI 场景保持一致
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
        // 传递对话元数据，确保首次对话正确注入技能附件
        conversationMeta: {
          isNewConversation: isFirstMessage,
          conversationStartTime: Date.now(),
        },
        // 模块配置：默认启用 MCP/Skills/Memory，禁用 Connector（避免循环调用）
        modules: {
          mcps: this.config.modules?.mcps ?? true,
          skills: this.config.modules?.skills ?? true,
          memory: this.config.modules?.memory ?? true,
          connectors: this.config.modules?.connectors ?? false,
        },
      })

      // 6. 执行 Agent（流式，支持自动审批循环）
      // 使用 stream 方法确保工具调用循环正确执行
      // 当 needsApproval 返回 true 时，SDK 会暂停并等待审批响应
      // Connector 场景需要自动审批并继续执行
      const messagesToProcess = adjustedMessages ?? messages
      const sanitizedMessages = sanitizeMessagesForConversion(messagesToProcess)
      let currentMessages = await convertToModelMessages(sanitizedMessages)

      // 7. 处理流式输出（支持审批循环）
      let responseText = ''
      const writtenFiles: Array<{ path: string; content: string }> = []
      let steps: unknown[] = []
      let finishReason: string = ''
      let maxApprovalRounds = 10 // 防止无限循环
      let approvalRound = 0
      // 保存最后一次 stream 结果用于获取最终文本
      let lastStreamText: string = ''

      while (approvalRound < maxApprovalRounds) {
        approvalRound++

        // 必须先 await stream() 返回的 Promise，才能访问 fullStream 等属性
        const streamResult = await agent.stream({
          messages: currentMessages,
        })

        // 消费 fullStream 获取文本和审批请求
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
          // 从工具调用中提取 write_file 内容（流式阶段）
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
          // 处理审批请求 - 这是关键！
          // ToolApprovalRequestOutput 类型结构: { type, approvalId, toolCall }
          // toolCall 包含: { toolCallId, toolName, input }
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

        // 等待所有 Promise 完成
        finishReason = await streamResult.finishReason
        steps = await streamResult.steps
        lastStreamText = await streamResult.text || ''

        // 调试：打印执行结果
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

        // 如果没有审批请求，说明循环完成
        if (approvalRequests.length === 0) {
          break
        }

        // 处理审批请求 - 根据权限规则自动审批
        // 从 stream 输出的 steps 中提取完整的 assistant 内容
        // 需要包含 tool-call 部分，否则 SDK 无法找到对应的工具调用来执行
        const lastStep = steps[steps.length - 1] as Record<string, unknown> | undefined
        const stepContent = (lastStep?.content ?? []) as Array<{
          type: string
          toolCallId?: string
          toolName?: string
          input?: Record<string, unknown>
          text?: string
        }>

        // 提取 tool-call 部分
        const toolCallParts: Array<{
          type: 'tool-call'
          toolCallId: string
          toolName: string
          input: Record<string, unknown>
        }> = []

        // 提取 reasoning 部分（如果有）
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

        // 构建审批请求部分
        const approvalRequestParts: Array<{
          type: 'tool-approval-request'
          approvalId: string
          toolCallId: string
        }> = approvalRequests.map(req => ({
          type: 'tool-approval-request',
          approvalId: req.approvalId,
          toolCallId: req.toolCallId,
        }))

        // 组合 assistant 消息内容：reasoning + tool-call + tool-approval-request
        const assistantContent = [
          ...reasoningParts,
          ...toolCallParts,
          ...approvalRequestParts,
        ]

        // 构建审批响应内容（用于 tool 消息）
        const toolApprovalContent: Array<{
          type: 'tool-approval-response'
          approvalId: string
          approved: boolean
          reason?: string
        }> = []

        for (const req of approvalRequests) {
          // 检查权限规则
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
          } else {
            // 没有匹配规则的，默认自动批准（Connector 场景无人交互）
            console.log('[AgentInboundHandler] Auto-approved (no matching rule):', {
              toolName: req.toolName,
              input: req.input,
            })
            toolApprovalContent.push({
              type: 'tool-approval-response',
              approvalId: req.approvalId,
              approved: true,
            })
          }
        }

        // 更新消息列表，添加 assistant 消息和 tool 审批响应消息
        // AssistantContent 必须包含 tool-call，否则 SDK 无法执行工具
        currentMessages.push({
          role: 'assistant',
          content: assistantContent,
        } as ModelMessage)

        // ToolContent 格式: Array<ToolResultPart | ToolApprovalResponse>
        currentMessages.push({
          role: 'tool',
          content: toolApprovalContent,
        } as ModelMessage)

        console.log('[AgentInboundHandler] Resuming with approval responses:', toolApprovalContent.length)
      }

      if (approvalRound >= maxApprovalRounds) {
        console.warn('[AgentInboundHandler] Max approval rounds reached, stopping loop')
      }

      // 8. 提取响应文本（流式已累积）
      // 如果流式累积为空，使用最后一次 stream 的文本
      if (!responseText) {
        responseText = lastStreamText
      }

      if (writtenFiles.length > 0) {
        const fileSection = writtenFiles.map((f) => `📄 **${f.path}**\n\n${f.content}`).join('\n\n---\n\n')
        responseText = responseText.trim() ? `${responseText}\n\n${fileSection}` : fileSection
      }

      // 8.2 过滤系统信息内容（发送到飞书前）
      let finalResponse = this.filterSystemContent(responseText)

      // 如果过滤后为空，使用最后一次 stream 文本或默认消息
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
      // messagesToProcess 包含 skill_listing 等注入消息，需要过滤后再保存
      // 但保留原始用户消息（不包含注入消息）
      const messagesToSave = this.filterInjectedMessages(messages)  // 使用原始 messages，不含注入
      const finalMessages = [...messagesToSave, assistantMessage]
      store.messageStore.saveMessages(conversationId, finalMessages)

      // 11. 后台处理（使用 setImmediate，与 UI Chat 一致）
      const cwd = this.config.context.cwd

      setImmediate(() => {
        // 记忆提取（使用完整对话）
        extractMemoriesInBackground(finalMessages, userId, conversationId, model, cwd).catch((err: Error) =>
          console.error('[Memory Extraction] Error:', err)
        )

        // 标题生成（首次对话）
        if (isFirstMessage) {
          generateConversationTitle(messagesToSave, model)
            .then((title: string) => {
              store.conversationStore.updateConversationTitle(conversationId, title)
            })
            .catch((err: Error) => console.error('[Title Generation] Error:', err))
        }

        // 成本持久化
        sessionState.costTracker.persistToDB().catch((err: Error) =>
          console.error('[Cost Persist] Error:', err)
        )

        // 释放资源
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
   *
   * 某些模型可能会把 <system-reminder> 或技能列表当作回复的一部分
   * 需要在发送到飞书前过滤掉这些内容
   */
  private filterSystemContent(response: string): string {
    if (!response) return ''

    // 过滤 <system-reminder> 标签内容
    let filtered = response.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')

    // 过滤技能列表开头
    filtered = filtered.replace(/The following skills are available[\s\S]*?(?=\n\n[A-Z]|\n\n\n|$)/g, '')

    // 过滤 "New skills are now available" 开头
    filtered = filtered.replace(/New skills are now available[\s\S]*?(?=\n\n[A-Z]|\n\n\n|$)/g, '')

    // 清理多余空白
    filtered = filtered.trim()

    return filtered
  }

  /**
   * 过滤系统注入的消息
   *
   * messages 可能包含 skill_listing 等注入消息，
   * 这些消息不应保存到对话历史中（UI 用户不应该看到）
   *
   * @param messages - 原始消息列表
   * @returns 过滤后的消息列表
   */
  private filterInjectedMessages(messages: UIMessage[]): UIMessage[] {
    return messages.filter(msg => {
      // 过滤 skill_listing 消息（ID 以 skill-listing- 开头）
      if (msg.id.startsWith('skill-listing-')) {
        return false
      }

      // 过滤包含 <system-reminder> 的消息
      const text = this.extractMessageText(msg)
      if (text.includes('<system-reminder>')) {
        return false
      }

      // 过滤技能列表开头
      if (text.startsWith('The following skills are available') ||
          text.startsWith('New skills are now available')) {
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
   * channel_id 作为对话的唯一标识
   */
  private async findOrCreateConversation(event: InboundMessageEvent): Promise<string> {
    // 使用 channel_id 作为对话 ID（格式：connector_type_channel_id）
    const conversationId = `${event.connector_type}_${event.channel_id}`
    const store = this.config.context.runtime.dataStore

    const existing = store.conversationStore.getConversation(conversationId)
    if (existing) {
      return conversationId
    }

    // 创建新对话，标题使用发送者信息
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