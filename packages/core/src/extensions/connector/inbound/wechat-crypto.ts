// ============================================================
// 微信消息加解密 - SHA1 验签 + AES-256-CBC 解密
// 支持企业微信、微信公众号、微信客服三种形态
// ============================================================

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
  /**
   * 验证请求来自微信服务器
   * 算法：SHA1(token + timestamp + nonce) 排序后比较
   */
  verifySignature(params: WechatVerifyParams): boolean {
    const str = [params.token, params.timestamp, params.nonce]
      .sort()
      .join('')
    const hash = crypto.createHash('sha1').update(str).digest('hex')
    return hash === params.signature
  }

  /**
   * 验证消息签名（带 msg_signature 参数，用于加密模式）
   */
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

  /**
   * 解密消息体（AES-256-CBC，微信专有格式）
   * 消息格式：[16字节随机串][4字节消息长度][消息内容][AppID]
   */
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

    // 去除 PKCS#7 padding
    const padLen = decrypted[decrypted.length - 1]
    const content = decrypted.slice(0, decrypted.length - padLen)

    return this.parseMsgFormat(content, appId)
  }

  /**
   * 解析微信专有消息格式
   * 格式：[16字节随机串][4字节网络序消息长度][消息内容][AppID]
   */
  private parseMsgFormat(decrypted: Buffer, expectedAppId: string): DecryptedMessage {
    // 跳过 16 字节随机串
    let offset = 16

    // 读取 4 字节网络序（大端）消息长度
    const contentLen = decrypted.readUInt32BE(offset)
    offset += 4

    // 读取消息内容
    const content = decrypted.slice(offset, offset + contentLen).toString('utf-8')
    offset += contentLen

    // 读取 AppID
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

  /**
   * 加密回复消息（部分场景需要）
   */
  encrypt(replyMsg: string, aesKey: string, appId: string): string {
    const key = Buffer.from(aesKey + '=', 'base64')
    const iv = key.slice(0, 16)

    // 构建消息：[16字节随机串][4字节网络序消息长度][消息内容][AppID]
    const randomStr = crypto.randomBytes(16)
    const msgContent = Buffer.from(replyMsg, 'utf-8')
    const appIdBuf = Buffer.from(appId, 'utf-8')

    // 4 字节网络序长度
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32BE(msgContent.length, 0)

    const plainText = Buffer.concat([randomStr, lenBuf, msgContent, appIdBuf])

    // PKCS#7 padding
    const padLen = 32 - (plainText.length % 32)
    const padding = Buffer.alloc(padLen, padLen)
    const padded = Buffer.concat([plainText, padding])

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    cipher.setAutoPadding(false)

    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])
    return encrypted.toString('base64')
  }
}

/**
 * 解析微信 XML 消息
 */
export function parseWechatXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {}

  // 简单 XML 解析（生产环境建议使用 xml2js 等库）
  const tagRegex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g
  let match

  while ((match = tagRegex.exec(xml)) !== null) {
    result[match[1]] = match[2]
  }

  // 处理非 CDATA 标签
  const simpleTagRegex = /<(\w+)>([^<]+)<\/\1>/g
  while ((match = simpleTagRegex.exec(xml)) !== null) {
    result[match[1]] = match[2]
  }

  return result
}

/**
 * 将微信 XML 消息转换为统一事件格式
 */
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
