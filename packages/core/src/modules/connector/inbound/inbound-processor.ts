// ============================================================
// 入站事件处理器 - 与 Agent Core 集成
// ============================================================

import { ConnectorRegistry } from '../registry'
import { logger } from '../../../primitives/logger'
import type { InboundEvent } from './types'
import { ConnectorResponder } from './responder/responder'
import { enrichFeishuEvent } from './adapters/feishu'

export interface InboundEventResult {
  success: boolean
  response?: string
  conversationId?: string
  error?: string
}

export interface InboundEventHandler {
  handle(event: InboundEvent): Promise<InboundEventResult>
}

class DefaultInboundHandler implements InboundEventHandler {
  async handle(event: InboundEvent): Promise<InboundEventResult> {
    logger.debug('InboundProcessor', 'Received event:', {
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

export class InboundEventProcessor {
  private handler: InboundEventHandler = new DefaultInboundHandler()
  private registry?: ConnectorRegistry
  private responder?: ConnectorResponder

  setHandler(handler: InboundEventHandler): void {
    this.handler = handler
    logger.debug('InboundProcessor', 'Handler registered')
  }

  setRegistry(registry: ConnectorRegistry): void {
    this.registry = registry
    this.responder = new ConnectorResponder({ registry })
    logger.debug('InboundProcessor', 'Registry registered')
  }

  async handle(event: InboundEvent): Promise<void> {
    await this.processEvent(event)
  }

  private async processEvent(event: InboundEvent): Promise<void> {
    logger.debug('InboundProcessor', 'Processing event:', event.id)

    // 过滤 IM 平台 bot 发送的消息，防止机器人自我回复循环。
    // rest-api（调用方本就是系统）和 internal（cron）除外。
    const isImProtocol = event.protocol !== 'rest-api' && event.transport !== 'internal'
    if (event.sender.type === 'bot' && isImProtocol) {
      logger.debug('InboundProcessor', 'Skipping bot message:', event.id)
      return
    }

    let indicatorResultId: string | null = null
    if (this.registry) {
      indicatorResultId = await this.addProcessingIndicator(event)
    }

    try {
      // Worker 侧慢路径：下载附件等耗时操作（webhook 已快速返回）
      await this.enrichEvent(event)

      const result = await this.handler.handle(event)

      // 内部事件（如 cron）不需要回复
      const isInternalEvent = event.transport === 'internal'
      if (this.registry && !isInternalEvent) {
        if (result.success && result.response) {
          await this.sendReply(event, result.response)
        } else if (!result.success && result.error) {
          const errorMessage = `❌ 处理消息时出错：${result.error}`
          await this.sendReply(event, errorMessage)
        }
      }

      if (indicatorResultId && this.registry) {
        await this.removeProcessingIndicator(event, indicatorResultId)
      }
    } catch (error) {
      if (indicatorResultId && this.registry) {
        await this.removeProcessingIndicator(event, indicatorResultId)
      }

      logger.error('InboundProcessor', 'Processing error:', { eventId: event.id, error })
      // 重新抛出，让 inbox 的重试/死信机制生效
      throw error
    }
  }

  private async enrichEvent(event: InboundEvent): Promise<void> {
    if (event.protocol !== 'feishu' || !this.registry) return
    if (event.message.attachments?.length) return

    const connector = this.registry.getDefinition(event.connectorId)
    if (!connector) return

    await enrichFeishuEvent(event, {
      connectorId: event.connectorId,
      protocol: event.protocol,
      credentials: connector.variables || {},
      inbound: connector.inbound,
      connector,
    })
  }

  private async addProcessingIndicator(event: InboundEvent): Promise<string | null> {
    if (!this.registry) return null

    const connector = this.registry.getDefinition(event.connectorId)
    const indicator = connector?.inbound?.processing_indicator

    if (!indicator?.enabled) return null

    const messageId = event.message.id
    if (!messageId) {
      logger.debug('InboundProcessor', 'No message ID for indicator')
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
        logger.warn('InboundProcessor', `Add indicator failed [${event.connectorId}/${indicator.add_tool}]:`, result.error)
        return null
      }

      const reactionId = this.extractReactionId(result.result)
      if (reactionId) {
        logger.debug('InboundProcessor', 'Add indicator success:', reactionId)
        return reactionId
      } else {
        logger.warn('InboundProcessor', `Indicator returned invalid or missing reaction_id [${event.connectorId}]:`, JSON.stringify(result.result))
        return null
      }
    } catch (err) {
      logger.warn('InboundProcessor', `Add indicator error [${event.connectorId}/${indicator.add_tool}]:`, err)
      return null
    }
  }

  private extractReactionId(result: unknown): string | null {
    if (!result || typeof result !== 'object') return null

    const resultObj = result as Record<string, unknown>
    const data = resultObj.data

    if (!data || typeof data !== 'object') return null

    const dataObj = data as Record<string, unknown>
    const reactionId = dataObj.reaction_id

    if (typeof reactionId === 'string' && reactionId.length > 0) {
      return reactionId
    }

    return null
  }

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
        logger.warn('InboundProcessor', `Remove indicator failed [${event.connectorId}/${indicator.remove_tool}]:`, result.error)
      } else {
        logger.debug('InboundProcessor', 'Remove indicator success:', resultId)
      }
    } catch (err) {
      logger.warn('InboundProcessor', `Remove indicator error [${event.connectorId}/${indicator.remove_tool}]:`, err)
    }
  }

  private async sendReply(event: InboundEvent, response: string): Promise<void> {
    if (!this.registry) {
      logger.debug('InboundProcessor', 'No registry, cannot send reply')
      return
    }

    if (!this.responder) {
      logger.debug('InboundProcessor', 'No responder, cannot send reply')
      return
    }

    const address = {
      connectorId: event.replyAddress.connectorId,
      protocol: event.replyAddress.protocol,
      channelId: event.replyAddress.channelId,
      messageId: event.replyAddress.messageId,
      threadId: event.replyAddress.threadId,
      raw: event.replyAddress.raw,
    }
    const message = { type: 'text' as const, text: response }

    // 指数退避重试：Agent 已产出的回复不能因一次网络抖动而丢失
    const MAX_REPLY_ATTEMPTS = 3
    let lastError: string | undefined
    for (let attempt = 1; attempt <= MAX_REPLY_ATTEMPTS; attempt++) {
      try {
        const result = await this.responder.respond(address, message)
        if (result.success) {
          logger.debug('InboundProcessor', 'Reply sent:', `${event.connectorId} ${event.channel.id}`)
          return
        }
        lastError = result.error
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }

      if (attempt < MAX_REPLY_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)))
      }
    }

    logger.error('InboundProcessor', `Reply failed after ${MAX_REPLY_ATTEMPTS} attempts:`, lastError)
    // 抛出让 inbox 重试整条消息处理（含回复投递）
    throw new Error(`REPLY_DELIVERY_FAILED: ${lastError}`)
  }
}
