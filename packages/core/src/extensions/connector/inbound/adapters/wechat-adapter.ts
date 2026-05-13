import { WechatMessageCrypto, xmlToInboundEvent } from '../crypto/wechat-crypto'
import type {
  AdapterInput,
  ConnectorInboundConfig,
  InboundAcceptResult,
  InboundEvent,
} from '../types'
import type { ProtocolAdapter } from './protocol-adapter'

const WECHAT_PROTOCOLS = new Set(['wecom', 'wechat-mp', 'wechat-kf'])

export class WechatProtocolAdapter implements ProtocolAdapter {
  private readonly crypto = new WechatMessageCrypto()

  constructor(readonly protocol: 'wecom' | 'wechat-mp' | 'wechat-kf') {}

  async challenge(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundAcceptResult | null> {
    const echostr = input.query.echostr
    if (!echostr) return null

    const verified = this.crypto.verifySignature({
      signature: input.query.signature || '',
      timestamp: input.query.timestamp || '',
      nonce: input.query.nonce || '',
      token: getCredential(config, 'token'),
    })

    if (!verified) {
      return { accepted: false, status: 400, reason: 'SIGNATURE_INVALID' }
    }

    const encodingAesKey = getCredential(config, 'encoding_aes_key', 'encodingAesKey')
    if (encodingAesKey) {
      try {
        const decrypted = this.crypto.decrypt(echostr, encodingAesKey, getWechatAppId(config, this.protocol))
        return { accepted: true, status: 200, body: decrypted.content }
      } catch {
        return { accepted: false, status: 400, reason: 'ECHOSTR_DECRYPTION_FAILED' }
      }
    }

    return { accepted: true, status: 200, body: echostr }
  }

  async verify(input: AdapterInput, config: ConnectorInboundConfig): Promise<boolean> {
    const token = getCredential(config, 'token')
    const msgSignature = input.query.msg_signature

    if (msgSignature) {
      return this.crypto.verifyMessageSignature({
        msgSignature,
        timestamp: input.query.timestamp || '',
        nonce: input.query.nonce || '',
        encryptMsg: input.body || '',
        token,
      })
    }

    return this.crypto.verifySignature({
      signature: input.query.signature || '',
      timestamp: input.query.timestamp || '',
      nonce: input.query.nonce || '',
      token,
    })
  }

  async decrypt(input: AdapterInput, config: ConnectorInboundConfig): Promise<AdapterInput> {
    const encodingAesKey = getCredential(config, 'encoding_aes_key', 'encodingAesKey')
    if (!encodingAesKey || !input.query.msg_signature) return input

    const encryptMatch = (input.body || '').match(/<Encrypt>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/Encrypt>/)
    const encryptedMsg = encryptMatch ? encryptMatch[1] : input.body || ''
    const decrypted = this.crypto.decrypt(encryptedMsg, encodingAesKey, getWechatAppId(config, this.protocol))

    return {
      ...input,
      body: decrypted.rawXml,
      raw: {
        encrypted: input.body,
        decrypted,
      },
    }
  }

  async parse(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundEvent> {
    const subtype = normalizeWechatProtocol(config.protocol)
    const parsed = xmlToInboundEvent(input.body || '', subtype)
    const channelId = parsed.chatId || parsed.senderId
    const externalEventId = parsed.messageId || `${subtype}-${channelId}-${input.receivedAt}`

    return {
      id: `${config.connectorId}:${input.transport}:${externalEventId}`,
      connectorId: config.connectorId,
      protocol: subtype,
      transport: input.transport,
      externalEventId,
      channel: {
        id: channelId,
      },
      sender: {
        id: parsed.senderId,
        name: parsed.senderName,
        type: 'user',
      },
      message: {
        id: parsed.messageId || externalEventId,
        type: parsed.messageType === 'text' ? 'text' : 'event',
        text: parsed.content,
        raw: { xml: input.body, parsed, raw: input.raw },
      },
      replyAddress: {
        connectorId: config.connectorId,
        protocol: subtype,
        channelId,
        messageId: parsed.messageId || undefined,
        raw: { xml: input.body, parsed },
      },
      receivedAt: input.receivedAt,
    }
  }
}

export function isWechatProtocol(protocol: string): protocol is 'wecom' | 'wechat-mp' | 'wechat-kf' {
  return WECHAT_PROTOCOLS.has(protocol)
}

function normalizeWechatProtocol(protocol: string): 'wecom' | 'wechat-mp' | 'wechat-kf' {
  if (isWechatProtocol(protocol)) return protocol
  return 'wecom'
}

function getWechatAppId(config: ConnectorInboundConfig, protocol: string): string {
  if (protocol === 'wecom') {
    return getCredential(config, 'corp_id', 'app_id', 'appId')
  }
  return getCredential(config, 'app_id', 'corp_id', 'appId')
}

function getCredential(config: ConnectorInboundConfig, ...keys: string[]): string {
  for (const key of keys) {
    const value = config.credentials[key]
    if (typeof value === 'string') return value
  }
  return ''
}

