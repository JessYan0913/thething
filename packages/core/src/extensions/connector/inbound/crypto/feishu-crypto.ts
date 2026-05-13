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

export class FeishuMessageCrypto {
  verifySignature(params: FeishuVerifyParams): boolean {
    const content = params.timestamp + params.nonce + params.encryptKey + params.body
    const hash = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
    return hash === params.signature
  }

  decrypt(encrypted: string, encryptKey: string): FeishuDecryptedMessage {
    const key = crypto.createHash('sha256').update(encryptKey).digest()

    const buf = Buffer.from(encrypted, 'base64')
    const iv = buf.slice(0, 16)
    const ciphertext = buf.slice(16)

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
}
