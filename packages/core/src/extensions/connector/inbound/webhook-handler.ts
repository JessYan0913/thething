// ============================================================
// Webhook 处理器工厂 - 根据 connector_type 创建对应的处理器
// ============================================================

import { WechatMessageCrypto, xmlToInboundEvent } from './wechat-crypto'
import { FeishuWebhookHandler } from './feishu-crypto'
import type { InboundMessageEvent } from '../types'
import { getIdempotencyGuard } from '../init'

export interface WebhookHandlerResult {
  success: boolean
  eventId?: string
  event?: InboundMessageEvent
  challenge?: string  // URL 验证时返回
  error?: string
}

export interface WebhookConfig {
  token?: string
  encodingAesKey?: string
  appId?: string
  subtype?: 'wecom' | 'wechat-mp' | 'wechat-kf'
  encryptKey?: string  // 飞书
  verificationToken?: string  // 飞书
}

/**
 * 微信 Webhook 处理器
 */
export class WechatWebhookHandler {
  private crypto: WechatMessageCrypto

  constructor() {
    this.crypto = new WechatMessageCrypto()
  }

  async handle(
    req: {
      query: Record<string, string>
      body: string
      headers: Record<string, string>
    },
    config: WebhookConfig
  ): Promise<WebhookHandlerResult> {
    const { signature, timestamp, nonce, msg_signature } = req.query

    // URL 验证场景（首次配置 Webhook）
    if (req.query.echostr) {
      return this.handleUrlVerification(req.query, config)
    }

    // 1. 验签
    const verifyParams = {
      signature: signature || '',
      timestamp: timestamp || '',
      nonce: nonce || '',
      token: config.token || '',
    }

    const verified = msg_signature
      ? this.crypto.verifyMessageSignature({
          msgSignature: msg_signature,
          timestamp: verifyParams.timestamp,
          nonce: verifyParams.nonce,
          encryptMsg: req.body,
          token: config.token || '',
        })
      : this.crypto.verifySignature(verifyParams)

    if (!verified) {
      console.warn('[WechatWebhook] Signature verification failed')
      return { success: false, error: 'SIGNATURE_INVALID' }
    }

    // 2. 解密（如果配置了加密）
    let xmlContent: string
    if (config.encodingAesKey && msg_signature) {
      // 加密模式
      try {
        // 解析 XML 获取 Encrypt 字段
        const encryptMatch = req.body.match(/<Encrypt>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/Encrypt>/)
        const encryptedMsg = encryptMatch ? encryptMatch[1] : req.body

        const decrypted = this.crypto.decrypt(encryptedMsg, config.encodingAesKey, config.appId || '')
        xmlContent = decrypted.rawXml
      } catch (err) {
        console.error('[WechatWebhook] Decryption failed:', err)
        return { success: false, error: 'DECRYPTION_FAILED' }
      }
    } else {
      // 明文模式
      xmlContent = req.body
    }

    // 3. 解析 XML 为统一事件
    const subtype = config.subtype || 'wecom'
    const parsed = xmlToInboundEvent(xmlContent, subtype)

    // 4. 幂等检查
    const guard = await getIdempotencyGuard()
    const isDuplicate = await guard.isDuplicate(parsed.messageId, 'wechat')
    if (isDuplicate) {
      console.log('[WechatWebhook] Duplicate message skipped:', parsed.messageId)
      return { success: true, eventId: parsed.messageId }  // 返回成功但不处理
    }

    // 5. 构建 InboundMessageEvent
    const event: InboundMessageEvent = {
      event_id: `wechat-${Date.now()}-${parsed.messageId}`,
      connector_type: subtype,
      channel_id: parsed.chatId || parsed.senderId,
      sender: {
        id: parsed.senderId,
        name: parsed.senderName,
        type: 'user',
      },
      message: {
        id: parsed.messageId,
        type: parsed.messageType === 'text' ? 'text' : 'event',
        text: parsed.content,
        raw: { xml: xmlContent, parsed },
      },
      timestamp: Date.now(),
      reply_context: {
        connector_type: subtype,
        channel_id: parsed.chatId || parsed.senderId,
        reply_to_message_id: parsed.messageId,
      },
    }

    return { success: true, eventId: event.event_id, event }
  }

  /**
   * 处理微信 URL 验证请求
   */
  private handleUrlVerification(
    query: Record<string, string>,
    config: WebhookConfig
  ): WebhookHandlerResult {
    const { signature, timestamp, nonce, echostr } = query

    // 验签
    const verified = this.crypto.verifySignature({
      signature: signature || '',
      timestamp: timestamp || '',
      nonce: nonce || '',
      token: config.token || '',
    })

    if (!verified) {
      return { success: false, error: 'SIGNATURE_INVALID' }
    }

    // 解密 echostr（加密模式）
    if (config.encodingAesKey && echostr) {
      try {
        const decrypted = this.crypto.decrypt(echostr, config.encodingAesKey, config.appId || '')
        return { success: true, challenge: decrypted.content }
      } catch {
        return { success: false, error: 'ECHOSTR_DECRYPTION_FAILED' }
      }
    }

    return { success: true, challenge: echostr }
  }
}

/**
 * 飞书 Webhook 处理器（使用框架实现）
 */
export class FeishuWebhookHandlerAdapter {
  private handler: FeishuWebhookHandler

  constructor() {
    this.handler = new FeishuWebhookHandler()
  }

  async handle(
    req: {
      query: Record<string, string>
      body: string
      headers: Record<string, string>
    },
    config: WebhookConfig
  ): Promise<WebhookHandlerResult> {
    // URL 验证场景
    try {
      const bodyJson = JSON.parse(req.body)
      if (bodyJson.type === 'url_verification' || bodyJson.challenge) {
        const result = this.handler.handleUrlVerification(req.body)
        return { success: true, challenge: result.challenge }
      }
    } catch {
      // 非 JSON 或非验证场景，继续处理
    }

    // 使用框架处理器
    const result = await this.handler.handle(
      {
        headers: req.headers,
        body: req.body,
        query: req.query,
      },
      {
        encryptKey: config.encryptKey || '',
        verificationToken: config.verificationToken || '',
      }
    )

    if (!result.success) {
      return { success: false, error: result.error }
    }

    // 幂等检查
    if (result.eventId) {
      const guard = await getIdempotencyGuard()
      const isDuplicate = await guard.isDuplicate(result.eventId, 'feishu')
      if (isDuplicate) {
        console.log('[FeishuWebhook] Duplicate message skipped:', result.eventId)
        return { success: true, eventId: result.eventId }
      }
    }

    return {
      success: true,
      eventId: result.eventId,
      event: result.event as InboundMessageEvent,
    }
  }
}

/**
 * Webhook 处理器工厂
 */
export function createWebhookHandler(connectorType: string): WechatWebhookHandler | FeishuWebhookHandlerAdapter | null {
  switch (connectorType) {
    case 'wecom':
    case 'wechat-mp':
    case 'wechat-kf':
      return new WechatWebhookHandler()

    case 'feishu':
      return new FeishuWebhookHandlerAdapter()

    default:
      console.warn('[WebhookFactory] Unknown connector type:', connectorType)
      return null
  }
}