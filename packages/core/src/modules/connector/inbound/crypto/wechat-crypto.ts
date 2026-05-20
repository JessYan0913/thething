import crypto from 'crypto'

export interface WechatVerifyParams {
  signature: string
  timestamp: string
  nonce: string
  token: string
}

export interface DecryptedMessage {
  appId: string
  content: string
  rawXml: string
}

export class WechatMessageCrypto {
  verifySignature(params: WechatVerifyParams): boolean {
    const str = [params.token, params.timestamp, params.nonce]
      .sort()
      .join('')
    const hash = crypto.createHash('sha1').update(str).digest('hex')
    return hash === params.signature
  }

  verifyMessageSignature(params: {
    msgSignature: string
    timestamp: string
    nonce: string
    encryptMsg: string
    token: string
  }): boolean {
    const str = [params.token, params.timestamp, params.nonce, params.encryptMsg]
      .sort()
      .join('')
    const hash = crypto.createHash('sha1').update(str).digest('hex')
    return hash === params.msgSignature
  }

  decrypt(encryptedMsg: string, aesKey: string, appId: string): DecryptedMessage {
    const key = Buffer.from(aesKey + '=', 'base64')
    const iv = key.slice(0, 16)

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    decipher.setAutoPadding(false)

    const encrypted = Buffer.from(encryptedMsg, 'base64')
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ])

    const padLen = decrypted[decrypted.length - 1]
    const content = decrypted.slice(0, decrypted.length - padLen)

    return this.parseMsgFormat(content, appId)
  }

  private parseMsgFormat(decrypted: Buffer, expectedAppId: string): DecryptedMessage {
    let offset = 16

    const contentLen = decrypted.readUInt32BE(offset)
    offset += 4

    const content = decrypted.slice(offset, offset + contentLen).toString('utf-8')
    offset += contentLen

    const msgAppId = decrypted.slice(offset).toString('utf-8')

    if (msgAppId !== expectedAppId) {
      throw new Error(
        `AppID mismatch: expected=${expectedAppId}, got=${msgAppId}`
      )
    }

    return {
      appId: msgAppId,
      content,
      rawXml: content,
    }
  }

  encrypt(replyMsg: string, aesKey: string, appId: string): string {
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
