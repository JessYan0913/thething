// ============================================================
// 飞书消息加解密 - HMAC-SHA256 验签 + AES-256-CBC 解密
// 框架实现，暂不连接实际飞书服务
// ============================================================

import crypto from 'crypto'

export interface FeishuVerifyParams {
  timestamp: string
  nonce: string
  signature: string
  body: string
  encryptKey: string
}

export interface FeishuDecryptedMessage {
  eventType: string
  event: unknown
  raw: unknown
}

/**
 * 飞书消息加解密处理器
 * 设计文档 §4.2 实现
 */
export class FeishuMessageCrypto {
  /**
   * 验证飞书消息签名
   * 算法：SHA256(timestamp + nonce + encryptKey + body)
   * 注：飞书文档描述与实际可能有差异，实际部署时需根据飞书文档调整
   */
  verifySignature(params: FeishuVerifyParams): boolean {
    const content = params.timestamp + params.nonce + params.encryptKey + params.body
    const hash = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
    return hash === params.signature
  }

  /**
   * 解密飞书加密消息
   * 飞书加密方式：AES-256-CBC
   * Key = SHA256(encryptKey)，IV 从加密数据前 16 字节提取
   */
  decrypt(encrypted: string, encryptKey: string): FeishuDecryptedMessage {
    // 生成密钥：SHA256(encryptKey)
    const key = crypto.createHash('sha256').update(encryptKey).digest()

    // 解析加密数据：前 16 字节为 IV，剩余为密文
    const buf = Buffer.from(encrypted, 'base64')
    const iv = buf.slice(0, 16)
    const ciphertext = buf.slice(16)

    // AES-256-CBC 解密，标准 PKCS5 padding
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])

    const json = JSON.parse(decrypted.toString('utf-8'))
    return {
      eventType: json.type || json.event_type || '',
      event: json.event || json,
      raw: json,
    }
  }

  /**
   * 将飞书事件转换为统一 InboundMessageEvent 格式
   * 设计文档 §4.2 parseToUnifiedEvent 实现
   */
  parseToInboundEvent(body: unknown): {
    eventId: string
    messageType: string
    chatId: string
    senderId: string
    content: string
    messageId: string
    timestamp: number
    raw: unknown
  } {
    // 飞书事件 JSON 结构
    // body = { header: { event_id, create_time, ... }, event: { sender, message, ... } }

    const header = (body as Record<string, unknown>).header as Record<string, unknown> | undefined
    const event = (body as Record<string, unknown>).event as Record<string, unknown> | undefined

    if (!header || !event) {
      throw new Error('Invalid feishu event structure: missing header or event')
    }

    const sender = event.sender as Record<string, unknown> | undefined
    const senderId = (sender?.sender_id as Record<string, unknown>)?.open_id as string || ''
    const message = event.message as Record<string, unknown> | undefined

    // 解析消息内容
    let contentText = ''
    if (message?.content) {
      try {
        const contentJson = JSON.parse(message.content as string)
        contentText = contentJson.text || ''
      } catch {
        contentText = message.content as string
      }
    }

    return {
      eventId: header.event_id as string || '',
      messageType: (message?.message_type as string) || 'text',
      chatId: (message?.chat_id as string) || '',
      senderId,
      content: contentText,
      messageId: (message?.message_id as string) || '',
      timestamp: parseInt(header.create_time as string) || Date.now(),
      raw: body,
    }
  }

  /**
   * 构建回复上下文（用于 Agent 回复时透传）
   */
  buildReplyContext(body: unknown): {
    connectorType: 'feishu'
    channelId: string
    replyToMessageId: string
  } {
    const parsed = this.parseToInboundEvent(body)
    return {
      connectorType: 'feishu',
      channelId: parsed.chatId,
      replyToMessageId: parsed.messageId,
    }
  }
}

/**
 * 飞书 Webhook 请求处理器（框架）
 * 实际部署时需要：
 * 1. 配置真实的 encrypt_key 和 verification_token
 * 2. 连接到 Agent Core 进行消息处理
 */
export class FeishuWebhookHandler {
  private crypto: FeishuMessageCrypto

  constructor() {
    this.crypto = new FeishuMessageCrypto()
  }

  /**
   * 处理飞书 Webhook POST 请求
   * @param req - 原始请求
   * @param config - Connector 配置（包含 encrypt_key, verification_token）
   * @returns 处理结果
   */
  async handle(
    req: {
      headers: Record<string, string>
      body: string
      query: Record<string, string>
    },
    config: {
      encryptKey: string
      verificationToken: string
    }
  ): Promise<{
    success: boolean
    eventId?: string
    error?: string
    event?: unknown
  }> {
    const timestamp = req.headers['x-lark-request-timestamp'] || req.query.timestamp || ''
    const nonce = req.headers['x-lark-request-nonce'] || req.query.nonce || ''
    const signature = req.headers['x-lark-signature'] || req.query.signature || ''

    // 1. 验签
    const verified = this.crypto.verifySignature({
      timestamp,
      nonce,
      signature,
      body: req.body,
      encryptKey: config.encryptKey,
    })

    if (!verified) {
      console.warn('[FeishuWebhook] Signature verification failed')
      return { success: false, error: 'SIGNATURE_INVALID' }
    }

    // 2. 解析请求体
    let bodyJson: unknown
    try {
      bodyJson = JSON.parse(req.body)
    } catch {
      // 可能是加密消息
      const encryptData = (JSON.parse(req.body) as Record<string, unknown>).encrypt as string
      if (encryptData) {
        bodyJson = this.crypto.decrypt(encryptData, config.encryptKey).raw
      } else {
        return { success: false, error: 'INVALID_BODY_FORMAT' }
      }
    }

    // 3. 解析为统一事件格式
    const parsed = this.crypto.parseToInboundEvent(bodyJson)

    // 4. 幂等检查（同一 event_id 不重复处理）
    // 注：实际部署时需要连接 IdempotencyGuard
    console.log('[FeishuWebhook] Received event:', parsed.eventId, parsed.messageType)

    // 5. 构建事件（推送给 Agent Core）
    const inboundEvent = {
      event_id: parsed.eventId,
      connector_type: 'feishu',
      channel_id: parsed.chatId,
      sender: {
        id: parsed.senderId,
        type: 'user',
      },
      message: {
        id: parsed.messageId,
        type: parsed.messageType as 'text' | 'image' | 'file' | 'event',
        text: parsed.content,
        raw: parsed.raw,
      },
      timestamp: parsed.timestamp,
      reply_context: this.crypto.buildReplyContext(bodyJson),
    }

    // 框架实现：返回事件，由外部调用者决定如何推送给 Agent
    return {
      success: true,
      eventId: parsed.eventId,
      event: inboundEvent,
    }
  }

  /**
   * 处理飞书 URL 验证请求（首次配置 Webhook 时）
   * 飞书会发送 challenge 字段，需要原样返回
   */
  handleUrlVerification(body: string): {
    challenge: string
  } {
    const json = JSON.parse(body) as Record<string, unknown>
    const challenge = json.challenge as string || ''
    return { challenge }
  }
}