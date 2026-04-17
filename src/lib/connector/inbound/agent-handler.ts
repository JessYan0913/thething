// ============================================================
// Agent 入站处理器 - 连接 Agent Core 处理 Webhook 消息
// ============================================================

import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { nanoid } from 'nanoid'
import type { InboundMessageEvent } from '../types'
import type { InboundEventResult, InboundEventHandler } from './inbound-processor'
import { getMessagesByConversation, saveMessages, createConversation, getConversation } from '@/lib/chat-store'
import { buildSystemPrompt } from '@/lib/system-prompt'
import { findRelevantMemories, buildMemorySection, getUserMemoryDir, ensureMemoryDirExists } from '@/lib/memory'
import { ConnectorRegistry } from '../registry'

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
})

/**
 * Agent 入站处理器配置
 */
export interface AgentHandlerConfig {
  registry: ConnectorRegistry
  userId?: string
  model?: string
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
      const existingMessages = getMessagesByConversation(conversationId)
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
      const model = this.config.model || process.env.DASHSCOPE_MODEL || 'qwen-max'
      const { text: response } = await generateText({
        model: dashscope(model),
        system: prompt,
        messages: messages.map(m => ({
          role: m.role,
          content: m.parts
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.type === 'text' ? p.text : '')
            .join('\n'),
        })),
        maxOutputTokens: 1000,
        temperature: 0.7,
      })

      // 7. 构建助手消息并保存
      const assistantMessage = this.buildAssistantMessage(response)
      await saveMessages(conversationId, [...messages, assistantMessage])

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

    const existing = getConversation(conversationId)
    if (existing) {
      return conversationId
    }

    // 创建新对话，标题使用发送者信息
    const title = `${event.connector_type} - ${event.sender.name || event.sender.id}`
    createConversation(conversationId, title)
    console.log('[AgentInboundHandler] Created conversation:', conversationId)

    return conversationId
  }

  /**
   * 构建用户消息
   */
  private buildUserMessage(event: InboundMessageEvent): any {
    return {
      id: nanoid(),
      role: 'user',
      parts: [
        {
          type: 'text',
          text: event.message.text || '',
        },
      ],
      createdAt: new Date().toISOString(),
      metadata: {
        sender: event.sender,
        channel: event.channel_id,
        connector: event.connector_type,
        messageId: event.message.id,
      },
    }
  }

  /**
   * 构建助手消息
   */
  private buildAssistantMessage(response: string): any {
    return {
      id: nanoid(),
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: response,
        },
      ],
      createdAt: new Date().toISOString(),
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