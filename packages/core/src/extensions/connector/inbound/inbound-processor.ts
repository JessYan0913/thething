// ============================================================
// 入站事件处理器 - 与 Agent Core 集成
// ============================================================

import type { InboundMessageEvent } from '../types'
import { inboundEventQueue } from './event-queue'
import { ConnectorRegistry } from '../registry'
import { auditLogger } from '../audit-logger'
import { debugLog, debugWarn, debugError } from '../debug'

/**
 * 入站事件处理结果
 */
export interface InboundEventResult {
  success: boolean
  response?: string
  conversationId?: string
  error?: string
}

/**
 * 入站事件处理器接口
 * 实现此接口来连接 Agent Core
 */
export interface InboundEventHandler {
  /**
   * 处理入站消息事件
   * @param event 入站消息事件
   * @returns 处理结果
   */
  handle(event: InboundMessageEvent): Promise<InboundEventResult>
}

/**
 * 默认处理器（日志记录，不连接 Agent）
 * 实际部署时应替换为真实的 Agent 集成
 */
class DefaultInboundHandler implements InboundEventHandler {
  async handle(event: InboundMessageEvent): Promise<InboundEventResult> {
    debugLog('[DefaultInboundHandler] Received event:', {
      eventId: event.event_id,
      connectorType: event.connector_type,
      channelId: event.channel_id,
      senderId: event.sender.id,
      messageText: event.message.text?.substring(0, 50),
    })

    // 记录审计日志
    auditLogger.logInboundMessage(event.connector_type, event.event_id, 'success', 'Event received')

    return {
      success: true,
      response: 'Event received and logged (no Agent connected)',
    }
  }
}

/**
 * 入站事件处理管理器
 * 管理事件处理器的注册和事件分发
 */
class InboundEventProcessor {
  private handler: InboundEventHandler = new DefaultInboundHandler()
  private registry?: ConnectorRegistry

  /**
   * 设置事件处理器
   */
  setHandler(handler: InboundEventHandler): void {
    this.handler = handler
    debugLog('[InboundEventProcessor] Handler registered')
  }

  /**
   * 设置 Connector Registry（用于发送回复）
   */
  setRegistry(registry: ConnectorRegistry): void {
    this.registry = registry
    debugLog('[InboundEventProcessor] Registry registered')
  }

  /**
   * 启动处理（注册到事件队列）
   */
  start(): void {
    inboundEventQueue.onEvent(async (event) => {
      debugLog('[InboundEventProcessor] Processing event:', event.event_id)

      // 处理状态指示器：添加"正在处理"表情
      let indicatorResultId: string | undefined = undefined
      if (this.registry) {
        indicatorResultId = await this.addProcessingIndicator(event)
      }

      try {
        const result = await this.handler.handle(event)

        // 如果有回复，通过 Connector 发送
        if (result.success && result.response && this.registry) {
          await this.sendReply(event, result.response)
        }

        // 处理完成：移除"正在处理"表情
        if (indicatorResultId && this.registry) {
          await this.removeProcessingIndicator(event, indicatorResultId)
        }

        // 记录处理结果
        auditLogger.logInboundMessage(
          event.connector_type,
          event.event_id,
          result.success ? 'success' : 'failure',
          result.response || result.error || ''
        )

      } catch (error) {
        // 失败：移除"正在处理"表情
        if (indicatorResultId && this.registry) {
          await this.removeProcessingIndicator(event, indicatorResultId)
        }

        debugError('[InboundEventProcessor] Processing error:', event.event_id, error)
        auditLogger.logInboundMessage(
          event.connector_type,
          event.event_id,
          'failure',
          error instanceof Error ? error.message : String(error)
        )
      }
    })

    debugLog('[InboundEventProcessor] Started')
  }

  /**
   * 添加处理状态指示器
   */
  private async addProcessingIndicator(event: InboundMessageEvent): Promise<string | undefined> {
    if (!this.registry) return undefined

    const connector = this.registry.getDefinition(event.connector_type)
    const indicator = connector?.inbound?.processing_indicator

    if (!indicator?.enabled) return undefined

    const messageId = event.message.id
    if (!messageId) return undefined

    try {
      const result = await this.registry.callTool({
        connector_id: event.connector_type,
        tool_name: indicator.add_tool,
        tool_input: {
          message_id: messageId,
          ...indicator.add_input,
        },
      })

      if (!result.success) {
        debugWarn('[InboundEventProcessor] Add indicator failed:', result.error)
        return undefined
      }

      // 提取 reaction_id 或其他标识
      const resultId = (result.result as { data?: { reaction_id?: string } })?.data?.reaction_id
      debugLog('[InboundEventProcessor] Add indicator success:', resultId)
      return resultId
    } catch (err) {
      debugWarn('[InboundEventProcessor] Add indicator error:', err)
      return undefined
    }
  }

  /**
   * 移除处理状态指示器
   */
  private async removeProcessingIndicator(event: InboundMessageEvent, resultId: string): Promise<void> {
    if (!this.registry || !resultId) return

    const connector = this.registry.getDefinition(event.connector_type)
    const indicator = connector?.inbound?.processing_indicator

    if (!indicator?.enabled) return

    const messageId = event.message.id
    if (!messageId) return

    try {
      const result = await this.registry.callTool({
        connector_id: event.connector_type,
        tool_name: indicator.remove_tool,
        tool_input: {
          message_id: messageId,
          reaction_id: resultId,
        },
      })

      if (!result.success) {
        debugWarn('[InboundEventProcessor] Remove indicator failed:', result.error)
      } else {
        debugLog('[InboundEventProcessor] Remove indicator success:', resultId)
      }
    } catch (err) {
      debugWarn('[InboundEventProcessor] Remove indicator error:', err)
    }
  }

  /**
   * 发送回复到外部系统
   */
  private async sendReply(event: InboundMessageEvent, response: string): Promise<void> {
    if (!this.registry) {
      debugWarn('[InboundEventProcessor] No registry, cannot send reply')
      return
    }

    // 根据 connector_type 选择发送工具
    const toolName = this.getReplyToolName(event.connector_type)
    const connectorId = this.getReplyConnectorId(event.connector_type)

    if (!toolName || !connectorId) {
      debugWarn('[InboundEventProcessor] No reply tool for connector type:', event.connector_type)
      return
    }

    // 调用 Connector 发送回复
    const result = await this.registry.callTool({
      connector_id: connectorId,
      tool_name: toolName,
      tool_input: {
        reply_context: event.reply_context,
        text: response,
      },
    })

    if (!result.success) {
      debugError('[InboundEventProcessor] Reply failed:', result.error)
    } else {
      debugLog('[InboundEventProcessor] Reply sent:', event.connector_type, event.channel_id)
    }
  }

  /**
   * 获取回复工具名称
   */
  private getReplyToolName(connectorType: string): string | null {
    switch (connectorType) {
      case 'wecom':
      case 'wechat-mp':
      case 'wechat-kf':
        return 'send_message'

      case 'feishu':
        return 'reply_message'

      default:
        return null
    }
  }

  /**
   * 获取回复 Connector ID
   */
  private getReplyConnectorId(connectorType: string): string | null {
    // 通常 connector_type 与 connector_id 相同
    // 但有些场景可能需要映射（如多个微信应用）
    return connectorType
  }

  /**
   * 获取队列统计
   */
  getStats() {
    return inboundEventQueue.getStats()
  }

  /**
   * 获取待处理事件
   */
  getPendingEvents(limit = 10) {
    return inboundEventQueue.getQueue({ status: 'pending', limit })
  }
}

// 单例导出
export const inboundEventProcessor = new InboundEventProcessor()

/**
 * Agent Core 集成示例
 *
 * 在 Agent Core 中实现 InboundEventHandler 并注册：
 *
 * ```typescript
 * import { inboundEventProcessor, InboundEventHandler, InboundEventResult } from '@/connector'
 *
 * class AgentInboundHandler implements InboundEventHandler {
 *   async handle(event: InboundMessageEvent): Promise<InboundEventResult> {
 *     // 1. 查找或创建对话
 *     const conversation = await this.findOrCreateConversation(event)
 *
 *     // 2. 将消息添加到对话历史
 *     await this.addMessageToConversation(conversation.id, {
 *       role: 'user',
 *       content: event.message.text || '',
 *       metadata: {
 *         sender: event.sender,
 *         channel: event.channel_id,
 *         connector: event.connector_type,
 *       }
 *     })
 *
 *     // 3. 调用 LLM 生成回复
 *     const response = await this.generateResponse(conversation, event)
 *
 *     return {
 *       success: true,
 *       response,
 *       conversationId: conversation.id,
 *     }
 *   }
 * }
 *
 * // 注册处理器
 * inboundEventProcessor.setHandler(new AgentInboundHandler())
 * inboundEventProcessor.start()
 * ```
 */

// 导出类型
export type { InboundEventProcessor }