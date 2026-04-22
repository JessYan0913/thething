// ============================================================
// Agent 入站处理器 - 连接 Agent Core 处理 Webhook 消息
// ============================================================

import { generateText } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { nanoid } from 'nanoid'
import type { InboundMessageEvent } from '../types'
import type { InboundEventResult, InboundEventHandler } from './inbound-processor'
import { getGlobalDataStore } from '../../../foundation/datastore'
import { buildSystemPrompt } from '../../../extensions/system-prompt'
import { findRelevantMemories, buildMemorySection, getUserMemoryDir, ensureMemoryDirExists } from '../../../extensions/memory'
import { ConnectorRegistry } from '../registry'
import type { UIMessage } from 'ai'

/**
 * Agent 入站处理器配置
 */
export interface AgentHandlerConfig {
  registry: ConnectorRegistry
  userId?: string
  /** 模型实例（必须提供） */
  model: LanguageModelV3
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
    console.log('[AgentInboundHandler] Processing event:', {
      eventId: event.event_id,
      connectorType: event.connector_type,
      channelId: event.channel_id,
      senderId: event.sender.id,
    })

    try {
      // 1. 根据 channel_id 查找或创建对话
      const conversationId = await this.findOrCreateConversation(event)

      // 2. 构建用户消息
      const userMessage = this.buildUserMessage(event)

      // 3. 获取对话历史
      const store = getGlobalDataStore()
      const existingMessages = store.messageStore.getMessagesByConversation(conversationId)
      const messages = [...existingMessages, userMessage]

      // 4. 获取记忆上下文
      const userId = this.config.userId || event.sender.id
      const memoryContext = await this.getMemoryContext(userId, event.message.text || '')

      // 5. 构建系统提示词
      const { prompt } = await buildSystemPrompt({
        includeProjectContext: false,
        memoryContext: {
          userId,
          recalledMemoriesContent: memoryContext,
        },
        conversationMeta: {
          messageCount: messages.length,
          isNewConversation: existingMessages.length === 0,
          conversationStartTime: Date.now(),
        },
      })

      // 6. 调用 LLM 生成回复
      if (!this.config.model) {
        throw new Error('[AgentInboundHandler] Model is required in config')
      }
      const { text: response } = await generateText({
        model: this.config.model,
        system: prompt,
        messages: messages.map(m => ({
          role: m.role,
          content: m.parts
            .filter((p) => p.type === 'text')
            .map((p) => p.type === 'text' ? p.text : '')
            .join('\n'),
        })),
        maxOutputTokens: 1000,
        temperature: 0.7,
      })

      // 7. 构建助手消息并保存
      const assistantMessage = this.buildAssistantMessage(response)
      store.messageStore.saveMessages(conversationId, [...messages, assistantMessage])

      console.log('[AgentInboundHandler] Generated response:', response.substring(0, 100))

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
    const store = getGlobalDataStore()

    const existing = store.conversationStore.getConversation(conversationId)
    if (existing) {
      return conversationId
    }

    // 创建新对话，标题使用发送者信息
    const title = `${event.connector_type} - ${event.sender.name || event.sender.id}`
    store.conversationStore.createConversation(conversationId, title)
    console.log('[AgentInboundHandler] Created conversation:', conversationId)

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

  /**
   * 获取记忆上下文
   */
  private async getMemoryContext(userId: string, query: string): Promise<string> {
    try {
      const userMemDir = getUserMemoryDir(userId)
      await ensureMemoryDirExists(userMemDir)

      if (!query) return ''

      const relevantMemories = await findRelevantMemories(query, userMemDir, {
        maxResults: 3,
      })

      if (relevantMemories.length === 0) return ''

      return await buildMemorySection(relevantMemories, userMemDir)
    } catch (error) {
      console.error('[AgentInboundHandler] Memory context error:', error)
      return ''
    }
  }
}

/**
 * 创建 Agent 入站处理器
 */
export function createAgentInboundHandler(config: AgentHandlerConfig): AgentInboundHandler {
  return new AgentInboundHandler(config)
}