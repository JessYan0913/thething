import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FeishuHttpProtocolAdapter } from '../adapters/feishu'
import type { AdapterInput, ConnectorInboundConfig } from '../types'

function makeConfig(credentials: Record<string, string> = {}): ConnectorInboundConfig {
  return {
    connectorId: 'feishu',
    protocol: 'feishu',
    credentials,
  }
}

function makeInput(body: unknown, headers: Record<string, string> = {}): AdapterInput {
  return {
    connectorId: 'feishu',
    protocol: 'feishu',
    transport: 'http',
    query: {},
    headers,
    body: JSON.stringify(body),
    receivedAt: Date.now(),
  }
}

function encryptFeishuPayload(payload: unknown, encryptKey: string): string {
  const key = crypto.createHash('sha256').update(encryptKey).digest()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf-8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, encrypted]).toString('base64')
}

const plainMessagePayload = {
  header: { event_id: 'evt-1', token: 'vtoken-123' },
  event: {
    sender: { sender_type: 'user', sender_id: { open_id: 'ou-1' } },
    message: {
      message_id: 'msg-1',
      chat_id: 'chat-1',
      message_type: 'text',
      content: JSON.stringify({ text: 'hi' }),
    },
  },
}

describe('FeishuHttpProtocolAdapter verify', () => {
  const adapter = new FeishuHttpProtocolAdapter()

  it('rejects plaintext webhook with wrong verification token', async () => {
    const config = makeConfig({ verification_token: 'vtoken-123' })
    const badPayload = { ...plainMessagePayload, header: { event_id: 'evt-1', token: 'wrong' } }
    expect(await adapter.verify(makeInput(badPayload), config)).toBe(false)
  })

  it('accepts plaintext webhook with correct verification token', async () => {
    const config = makeConfig({ verification_token: 'vtoken-123' })
    expect(await adapter.verify(makeInput(plainMessagePayload), config)).toBe(true)
  })

  it('accepts plaintext webhook without configured token (with warning)', async () => {
    const config = makeConfig()
    expect(await adapter.verify(makeInput(plainMessagePayload), config)).toBe(true)
  })

  it('rejects invalid body', async () => {
    const input = makeInput(plainMessagePayload)
    input.body = 'not-json'
    expect(await adapter.verify(input, makeConfig())).toBe(false)
  })

  it('verifies encrypted webhook signature', async () => {
    const encryptKey = 'test-encrypt-key'
    const config = makeConfig({ encrypt_key: encryptKey })
    const encrypt = encryptFeishuPayload(plainMessagePayload, encryptKey)
    const body = JSON.stringify({ encrypt })
    const timestamp = '1700000000'
    const nonce = 'nonce-1'
    const signature = crypto.createHash('sha256')
      .update(timestamp + nonce + encryptKey + body)
      .digest('hex')

    const input: AdapterInput = {
      connectorId: 'feishu',
      protocol: 'feishu',
      transport: 'http',
      query: {},
      headers: {
        'x-lark-request-timestamp': timestamp,
        'x-lark-request-nonce': nonce,
        'x-lark-signature': signature,
      },
      body,
      receivedAt: Date.now(),
    }
    expect(await adapter.verify(input, config)).toBe(true)

    input.headers['x-lark-signature'] = 'bad-signature'
    expect(await adapter.verify(input, config)).toBe(false)
  })
})

describe('FeishuHttpProtocolAdapter challenge', () => {
  const adapter = new FeishuHttpProtocolAdapter()

  it('echoes plaintext challenge', async () => {
    const result = await adapter.challenge(
      makeInput({ type: 'url_verification', challenge: 'abc' }),
      makeConfig(),
    )
    expect(result).toMatchObject({ accepted: true, status: 200, body: { challenge: 'abc' } })
  })

  it('decrypts and echoes encrypted challenge', async () => {
    const encryptKey = 'test-encrypt-key'
    const challengePayload = { type: 'url_verification', challenge: 'encrypted-abc' }
    const encrypt = encryptFeishuPayload(challengePayload, encryptKey)

    const result = await adapter.challenge(
      makeInput({ encrypt }),
      makeConfig({ encrypt_key: encryptKey }),
    )
    expect(result).toMatchObject({ accepted: true, status: 200, body: { challenge: 'encrypted-abc' } })
  })

  it('returns null for normal messages', async () => {
    const result = await adapter.challenge(makeInput(plainMessagePayload), makeConfig())
    expect(result).toBeNull()
  })
})

describe('FeishuHttpProtocolAdapter parse (envelope only)', () => {
  const adapter = new FeishuHttpProtocolAdapter()

  it('parses without downloading attachments', async () => {
    const imagePayload = {
      header: { event_id: 'evt-img' },
      event: {
        sender: { sender_type: 'user', sender_id: { open_id: 'ou-1' } },
        message: {
          message_id: 'msg-img',
          chat_id: 'chat-1',
          message_type: 'image',
          content: JSON.stringify({ image_key: 'img-key-1' }),
        },
      },
    }
    const event = await adapter.parse(makeInput(imagePayload), makeConfig())
    // 附件下载已移到 worker 侧；parse 只提取 envelope
    expect(event.message.attachments).toBeUndefined()
    expect(event.message.type).toBe('image')
    expect(event.message.text).toBe('img-key-1')
  })

  it('marks bot senders', async () => {
    const botPayload = {
      header: { event_id: 'evt-bot' },
      event: {
        sender: { sender_type: 'bot', sender_id: { open_id: 'ou-bot' } },
        message: {
          message_id: 'msg-bot',
          chat_id: 'chat-1',
          message_type: 'text',
          content: JSON.stringify({ text: 'from bot' }),
        },
      },
    }
    const event = await adapter.parse(makeInput(botPayload), makeConfig())
    expect(event.sender.type).toBe('bot')
  })
})
