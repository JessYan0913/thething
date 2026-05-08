// ============================================================
// Agent 入站处理器 - 连接 Agent Core 处理 Webhook 消息
// ============================================================

import type { UIMessage } from 'ai'
import { nanoid } from 'nanoid'
import type { InboundMessageEvent } from '../types'
import type { InboundEventResult, InboundEventHandler } from './inbound-processor'
import { createAgent, type AppContext } from '../../../api/app'
import { generateConversationTitle } from '../../../runtime/compaction'
import { extractMemoriesInBackground } from '../../../extensions/memory'
import { ConnectorRegistry } from '../registry'

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
}

/**
 * Agent 入站处理器
 * 接收 Webhook 消息，触发 Agent 对话，返回回复
 */
export class AgentInboundHandler implements InboundEventHandler {
  private config: AgentHandlerConfig

  constructor(config: AgentHandlerConfig) {
    this.config = config
  }

  async handle(event: InboundMessageEvent): Promise<InboundEventResult> {
    try {
      // 1. 根据 channel_id 查找或创建对话
      const conversationId = await this.findOrCreateConversation(event)

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
      const { agent, sessionState, adjustedMessages, model, dispose } = await createAgent({
        context: this.config.context,
        conversationId,
        messages,
        userId,
        model: {
          apiKey: process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY!,
          baseURL: process.env.DASHSCOPE_BASE_URL || process.env.OPENAI_BASE_URL!,
          modelName: process.env.THETHING_MODEL || process.env.DASHSCOPE_MODEL || 'qwen-max',
          includeUsage: true,
        },
        // 模块配置：默认启用 MCP/Skills/Memory，禁用 Connector（避免循环调用）
        modules: {
          mcps: this.config.modules?.mcps ?? true,
          skills: this.config.modules?.skills ?? true,
          memory: this.config.modules?.memory ?? true,
          connectors: this.config.modules?.connectors ?? false,
        },
      })

      // 6. 执行 Agent（非流式）
      const messagesToProcess = adjustedMessages ?? messages
      const result = await agent.generate({
        messages: messagesToProcess.map(m => ({
          role: m.role,
          content: m.parts
            .filter(p => p.type === 'text')
            .map(p => p.type === 'text' ? p.text : '')
            .join('\n'),
        })),
      })

      // 7. 获取响应文本
      const response = result.text

      // 8. 构建助手消息并保存
      const assistantMessage = this.buildAssistantMessage(response)
      const completedMessages = [...messagesToProcess, assistantMessage]
      // 保存原始消息 + 新消息（排除附件）
      const messagesToSave = [...messages, assistantMessage]
      store.messageStore.saveMessages(conversationId, messagesToSave)

      // 9. 后台处理
      const cwd = this.config.context.cwd

      // 记忆提取
      extractMemoriesInBackground(
        completedMessages,
        userId,
        conversationId,
        model,
        cwd,
      ).catch((err: Error) => console.error('[Memory Extraction] Error:', err))

      // 标题生成（首次对话）
      if (isFirstMessage) {
        generateConversationTitle(completedMessages, model)
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

      return {
        success: true,
        response,
        conversationId,
      }
    } catch (error) {
      console.error('[AgentInboundHandler] Error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
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

  /**
   * 构建助手消息
   */
  private buildAssistantMessage(response: string): UIMessage {
    return {
      id: nanoid(),
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: response,
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