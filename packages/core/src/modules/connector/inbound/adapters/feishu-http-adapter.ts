import { FeishuMessageCrypto } from '../crypto/feishu-crypto'
import type {
  AdapterInput,
  ConnectorInboundConfig,
  InboundAcceptResult,
  InboundEvent,
} from '../types'
import type { ProtocolAdapter } from './protocol-adapter'

export class FeishuHttpProtocolAdapter implements ProtocolAdapter {
  readonly protocol = 'feishu'
  private readonly crypto = new FeishuMessageCrypto()

  async challenge(input: AdapterInput): Promise<InboundAcceptResult | null> {
    const bodyJson = parseJsonObject(input.body)
    if (!bodyJson) return null

    if (bodyJson.type === 'url_verification' || typeof bodyJson.challenge === 'string') {
      return {
        accepted: true,
        status: 200,
        body: { challenge: bodyJson.challenge || '' },
      }
    }

    return null
  }

  async verify(input: AdapterInput, config: ConnectorInboundConfig): Promise<boolean> {
    const bodyJson = parseJsonObject(input.body)
    if (!bodyJson || typeof bodyJson.encrypt !== 'string') {
      return true
    }

    const encryptKey = getCredential(config, 'encrypt_key', 'encryptKey')
    if (!encryptKey) return false

    return this.crypto.verifySignature({
      timestamp: input.headers['x-lark-request-timestamp'] || input.query.timestamp || '',
      nonce: input.headers['x-lark-request-nonce'] || input.query.nonce || '',
      signature: input.headers['x-lark-signature'] || input.query.signature || '',
      body: input.body || '',
      encryptKey,
    })
  }

  async decrypt(input: AdapterInput, config: ConnectorInboundConfig): Promise<AdapterInput> {
    const bodyJson = parseJsonObject(input.body)
    if (!bodyJson || typeof bodyJson.encrypt !== 'string') return input

    const encryptKey = getCredential(config, 'encrypt_key', 'encryptKey')
    const decrypted = this.crypto.decrypt(bodyJson.encrypt, encryptKey)

    return {
      ...input,
      body: JSON.stringify(decrypted.raw),
      raw: {
        encrypted: bodyJson,
        decrypted,
      },
    }
  }

  async parse(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundEvent> {
    const bodyJson = parseJsonObject(input.body)
    if (!bodyJson) {
      throw new Error('INVALID_BODY_FORMAT')
    }

    return feishuPayloadToInboundEvent(bodyJson, {
      connectorId: config.connectorId,
      transport: input.transport,
      receivedAt: input.receivedAt,
      raw: input.raw ?? bodyJson,
    })
  }
}

export function feishuPayloadToInboundEvent(
  body: Record<string, unknown>,
  options: {
    connectorId: string
    transport: string
    receivedAt: number
    raw?: unknown
  },
): InboundEvent {
  const header = body.header as Record<string, unknown> | undefined
  const event = (body.event as Record<string, unknown> | undefined) ?? body
  const message = event.message as Record<string, unknown> | undefined
  const sender = event.sender as Record<string, unknown> | undefined
  const senderId = ((sender?.sender_id as Record<string, unknown> | undefined)?.open_id as string) || ''
  const messageId = (message?.message_id as string) || (header?.event_id as string) || `feishu-${options.receivedAt}`
  const chatId = (message?.chat_id as string) || ''
  const messageType = (message?.message_type as string) || 'text'
  const externalEventId = (header?.event_id as string) || messageId
  const createTime = parseInt((header?.create_time as string) || (message?.create_time as string) || '', 10)

  return {
    id: `${options.connectorId}:${options.transport}:${externalEventId}`,
    connectorId: options.connectorId,
    protocol: 'feishu',
    transport: options.transport,
    externalEventId,
    channel: {
      id: chatId,
      type: message?.chat_type as string | undefined,
    },
    sender: {
      id: senderId,
      type: (sender?.sender_type as string) === 'bot' ? 'bot' : 'user',
    },
    message: {
      id: messageId,
      type: messageType === 'text' ? 'text' : 'event',
      text: extractFeishuText(message?.content),
      raw: options.raw ?? body,
    },
    replyAddress: {
      connectorId: options.connectorId,
      protocol: 'feishu',
      channelId: chatId,
      messageId,
      threadId: (message?.root_id as string) || (message?.parent_id as string) || undefined,
      raw: body,
    },
    receivedAt: Number.isFinite(createTime) ? createTime : options.receivedAt,
  }
}

function extractFeishuText(content: unknown): string {
  if (typeof content !== 'string') return ''
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return typeof parsed.text === 'string' ? parsed.text : content
  } catch {
    return content
  }
}

function parseJsonObject(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function getCredential(config: ConnectorInboundConfig, ...keys: string[]): string {
  for (const key of keys) {
    const value = config.credentials[key]
    if (typeof value === 'string') return value
  }
  return ''
}

