import crypto from 'crypto'
import type {
  AdapterInput,
  ConnectorInboundConfig,
  InboundAcceptResult,
  InboundEvent,
  ProtocolAdapter,
} from '../types'

// ---- WeChat Crypto ----

interface WechatVerifyParams {
  signature: string
  timestamp: string
  nonce: string
  token: string
}

interface DecryptedMessage {
  appId: string
  content: string
  rawXml: string
}

function verifyWechatSignature(params: WechatVerifyParams): boolean {
  const str = [params.token, params.timestamp, params.nonce].sort().join('')
  const hash = crypto.createHash('sha1').update(str).digest('hex')
  return hash === params.signature
}

function verifyWechatMessageSignature(params: {
  msgSignature: string
  timestamp: string
  nonce: string
  encryptMsg: string
  token: string
}): boolean {
  const str = [params.token, params.timestamp, params.nonce, params.encryptMsg].sort().join('')
  const hash = crypto.createHash('sha1').update(str).digest('hex')
  return hash === params.msgSignature
}

function decryptWechatMessage(encryptedMsg: string, aesKey: string, appId: string): DecryptedMessage {
  const key = Buffer.from(aesKey + '=', 'base64')
  const iv = key.slice(0, 16)

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  decipher.setAutoPadding(false)

  const encrypted = Buffer.from(encryptedMsg, 'base64')
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

  const padLen = decrypted[decrypted.length - 1]
  const content = decrypted.slice(0, decrypted.length - padLen)

  return parseMsgFormat(content, appId)
}

function parseMsgFormat(decrypted: Buffer, expectedAppId: string): DecryptedMessage {
  let offset = 16
  const contentLen = decrypted.readUInt32BE(offset)
  offset += 4
  const content = decrypted.slice(offset, offset + contentLen).toString('utf-8')
  offset += contentLen
  const msgAppId = decrypted.slice(offset).toString('utf-8')

  if (msgAppId !== expectedAppId) {
    throw new Error(`AppID mismatch: expected=${expectedAppId}, got=${msgAppId}`)
  }

  return { appId: msgAppId, content, rawXml: content }
}

export function encryptWechatMessage(replyMsg: string, aesKey: string, appId: string): string {
  const key = Buffer.from(aesKey + '=', 'base64')
  const iv = key.slice(0, 16)

  const randomStr = crypto.randomBytes(16)
  const msgContent = Buffer.from(replyMsg, 'utf-8')
  const appIdBuf = Buffer.from(appId, 'utf-8')

  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(msgContent.length, 0)

  const plainText = Buffer.concat([randomStr, lenBuf, msgContent, appIdBuf])
  const padLen = 32 - (plainText.length % 32)
  const padding = Buffer.alloc(padLen, padLen)
  const padded = Buffer.concat([plainText, padding])

  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(false)

  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])
  return encrypted.toString('base64')
}

export function parseWechatXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {}

  const tagRegex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g
  let match
  while ((match = tagRegex.exec(xml)) !== null) {
    result[match[1]] = match[2]
  }

  const simpleTagRegex = /<(\w+)>([^<]+)<\/\1>/g
  while ((match = simpleTagRegex.exec(xml)) !== null) {
    result[match[1]] = match[2]
  }

  return result
}

export function xmlToInboundEvent(
  xml: string,
  subtype: 'wecom' | 'wechat-mp' | 'wechat-kf'
): {
  messageId: string
  senderId: string
  senderName?: string
  content: string
  messageType: string
  chatId?: string
} {
  const parsed = parseWechatXml(xml)

  const fieldMap = {
    'wecom': { sender: 'FromUserName', content: 'Content', chatId: 'AgentID' },
    'wechat-mp': { sender: 'FromUserName', content: 'Content', chatId: undefined },
    'wechat-kf': { sender: 'OpenKfId', content: 'Content', chatId: 'OpenKfId' },
  }

  const fields = fieldMap[subtype]

  return {
    messageId: parsed.MsgId ?? parsed.msg_id ?? '',
    senderId: parsed[fields.sender] ?? '',
    senderName: parsed.FromNickName ?? parsed.NickName,
    content: parsed[fields.content] ?? '',
    messageType: parsed.MsgType ?? 'text',
    chatId: fields.chatId ? parsed[fields.chatId] : undefined,
  }
}

// ---- Protocol Adapter ----

const WECHAT_PROTOCOLS = new Set(['wecom', 'wechat-mp', 'wechat-kf'])

export class WechatProtocolAdapter implements ProtocolAdapter {
  constructor(readonly protocol: 'wecom' | 'wechat-mp' | 'wechat-kf') {}

  async challenge(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundAcceptResult | null> {
    const echostr = input.query.echostr
    if (!echostr) return null

    const verified = verifyWechatSignature({
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
        const decrypted = decryptWechatMessage(echostr, encodingAesKey, getWechatAppId(config, this.protocol))
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
      return verifyWechatMessageSignature({
        msgSignature,
        timestamp: input.query.timestamp || '',
        nonce: input.query.nonce || '',
        encryptMsg: input.body || '',
        token,
      })
    }

    return verifyWechatSignature({
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
    const decrypted = decryptWechatMessage(encryptedMsg, encodingAesKey, getWechatAppId(config, this.protocol))

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
      channel: { id: channelId },
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
