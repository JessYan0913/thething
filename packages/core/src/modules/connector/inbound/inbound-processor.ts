// ============================================================
// 入站事件处理器 - 与 Agent Core 集成
// ============================================================

import { ConnectorRegistry } from '../registry'
import type { AuditLogger } from '../audit-logger'
import { debugLog, debugWarn, debugError } from '../debug'
import type { InboundEvent } from './types'
import { ConnectorResponder } from './responder/responder'

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
  handle(event: InboundEvent): Promise<InboundEventResult>
}

/**
 * 默认处理器（日志记录，不连接 Agent）
 * 实际部署时应替换为真实的 Agent 集成
 */
class DefaultInboundHandler implements InboundEventHandler {
  async handle(event: InboundEvent): Promise<InboundEventResult> {
    debugLog('[DefaultInboundHandler] Received event:', {
      eventId: event.id,
      connectorId: event.connectorId,
      protocol: event.protocol,
      channelId: event.channel.id,
      senderId: event.sender.id,
      messageText: event.message.text?.substring(0, 50),
    })

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
export class InboundEventProcessor {
  private handler: InboundEventHandler = new DefaultInboundHandler()
  private registry?: ConnectorRegistry
  private auditLoggerInstance?: AuditLogger
  private responder?: ConnectorResponder

  /**
   * 设置审计日志器
   */
  setAuditLogger(logger: AuditLogger): void {
    this.auditLoggerInstance = logger
    debugLog('[InboundEventProcessor] AuditLogger registered')
  }

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
    this.responder = new ConnectorResponder({ registry })
    debugLog('[InboundEventProcessor] Registry registered')
  }

  async handle(event: InboundEvent): Promise<void> {
    await this.processEvent(event)
  }

  private async processEvent(event: InboundEvent): Promise<void> {
    debugLog('[InboundEventProcessor] Processing event:', event.id)

    // 处理状态指示器：添加"正在处理"表情
    let indicatorResultId: string | null = null
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
      this.auditLoggerInstance?.logInboundMessage(
        event.connectorId,
        event.id,
        result.success ? 'success' : 'failure',
        result.response || result.error || ''
      )

    } catch (error) {
      // 失败：移除"正在处理"表情
      if (indicatorResultId && this.registry) {
        await this.removeProcessingIndicator(event, indicatorResultId)
      }

      debugError('[InboundEventProcessor] Processing error:', event.id, error)
      this.auditLoggerInstance?.logInboundMessage(
        event.connectorId,
        event.id,
        'failure',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  /**
   * 添加处理状态指示器
   */
  private async addProcessingIndicator(event: InboundEvent): Promise<string | null> {
    if (!this.registry) return null

    const connector = this.registry.getDefinition(event.connectorId)
    const indicator = connector?.inbound?.processing_indicator

    if (!indicator?.enabled) return null

    const messageId = event.message.id
    if (!messageId) {
      debugWarn('[InboundEventProcessor] No message ID for indicator')
      return null
    }

    try {
      const result = await this.registry.callTool({
        connectorId: event.connectorId,
        toolName: indicator.add_tool,
        input: {
          message_id: messageId,
          ...indicator.add_input,
        },
      })

      if (!result.success) {
        debugWarn('[InboundEventProcessor] Add indicator failed:', result.error)
        return null
      }

      // 安全提取 reaction_id，验证类型
      const reactionId = this.extractReactionId(result.result)
      if (reactionId) {
        debugLog('[InboundEventProcessor] Add indicator success:', reactionId)
        return reactionId
      } else {
        debugWarn('[InboundEventProcessor] Indicator returned invalid or missing reaction_id')
        return null
      }
    } catch (err) {
      debugWarn('[InboundEventProcessor] Add indicator error:', err)
      return null
    }
  }

  /**
   * 安全提取 reaction_id
   */
  private extractReactionId(result: unknown): string | null {
    if (!result || typeof result !== 'object') return null

    // 处理嵌套结构: result.data.reaction_id
    const resultObj = result as Record<string, unknown>
    const data = resultObj.data

    if (!data || typeof data !== 'object') return null

    const dataObj = data as Record<string, unknown>
    const reactionId = dataObj.reaction_id

    // 验证类型
    if (typeof reactionId === 'string' && reactionId.length > 0) {
      return reactionId
    }

    return null
  }

  /**
   * 移除处理状态指示器
   */
  private async removeProcessingIndicator(event: InboundEvent, resultId: string): Promise<void> {
    if (!this.registry || !resultId) return

    const connector = this.registry.getDefinition(event.connectorId)
    const indicator = connector?.inbound?.processing_indicator

    if (!indicator?.enabled) return

    const messageId = event.message.id
    if (!messageId) return

    try {
      const result = await this.registry.callTool({
        connectorId: event.connectorId,
        toolName: indicator.remove_tool,
        input: {
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
  private async sendReply(event: InboundEvent, response: string): Promise<void> {
    if (!this.registry) {
      debugWarn('[InboundEventProcessor] No registry, cannot send reply')
      return
    }

    if (!this.responder) {
      debugWarn('[InboundEventProcessor] No responder, cannot send reply')
      return
    }

    const result = await this.responder.respond({
      connectorId: event.replyAddress.connectorId,
      protocol: event.replyAddress.protocol,
      channelId: event.replyAddress.channelId,
      messageId: event.replyAddress.messageId,
      threadId: event.replyAddress.threadId,
      raw: event.replyAddress.raw,
    }, {
      type: 'text',
      text: response,
    })

    if (!result.success) {
      debugError('[InboundEventProcessor] Reply failed:', result.error)
    } else {
      debugLog('[InboundEventProcessor] Reply sent:', event.connectorId, event.channel.id)
    }
  }
}
