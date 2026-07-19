import crypto from 'crypto'
import type {
  AdapterInput,
  ConnectorInboundConfig,
  InboundAcceptResult,
  InboundEvent,
  MessageAttachment,
  ProtocolAdapter,
} from '../types'
import { logger } from '../../../../primitives/logger'

// ---- Feishu Media Helpers ----

/**
 * 根据文件扩展名获取媒体类型
 */
function getMediaType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  const mediaTypes: Record<string, string> = {
    'txt': 'text/plain',
    'md': 'text/markdown',
    'json': 'application/json',
    'xml': 'application/xml',
    'yaml': 'text/yaml',
    'yml': 'text/yaml',
    'csv': 'text/csv',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'ts': 'application/typescript',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
  }
  return mediaTypes[ext] || 'application/octet-stream'
}

/**
 * 判断是否为文本文件
 */
function isTextFile(fileName: string): boolean {
  const textExtensions = new Set([
    'txt', 'md', 'json', 'xml', 'yaml', 'yml', 'csv', 'html', 'css',
    'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp',
    'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'sql', 'sh', 'bash',
    'zsh', 'fish', 'ps1', 'bat', 'cmd', 'log', 'ini', 'cfg', 'conf', 'toml',
  ])
  const ext = fileName.toLowerCase().split('.').pop() || ''
  return textExtensions.has(ext)
}

/**
 * 获取飞书 tenant_access_token
 */
async function getFeishuToken(config: ConnectorInboundConfig): Promise<string | null> {
  const appId = getCredential(config, 'app_id', 'appId')
  const appSecret = getCredential(config, 'app_secret', 'appSecret')
  if (!appId || !appSecret) {
    logger.warn('FeishuAdapter', 'Missing app_id or app_secret')
    return null
  }

  try {
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
    const data = await response.json() as { tenant_access_token?: string; code?: number }
    if (data.tenant_access_token) {
      return data.tenant_access_token
    }
    logger.warn('FeishuAdapter', `Failed to get token: ${JSON.stringify(data)}`)
    return null
  } catch (error) {
    logger.error('FeishuAdapter', 'Error getting token:', error)
    return null
  }
}

/**
 * 下载飞书图片
 */
async function downloadFeishuImage(
  messageId: string,
  imageKey: string,
  token: string,
): Promise<MessageAttachment | null> {
  try {
    const imageUrl = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`
    const response = await fetch(imageUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.warn('FeishuAdapter', `Failed to download image: ${response.status} ${errorText}`)
      return null
    }

    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const dataUrl = `data:image/png;base64,${base64}`

    return {
      type: 'image',
      url: dataUrl,
      mediaType: 'image/png',
    }
  } catch (error) {
    logger.error('FeishuAdapter', 'Error downloading image:', error)
    return null
  }
}

/**
 * 下载飞书文件
 */
async function downloadFeishuFile(
  messageId: string,
  fileKey: string,
  fileName: string,
  token: string,
): Promise<MessageAttachment | null> {
  try {
    const fileUrl = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`
    const response = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.warn('FeishuAdapter', `Failed to download file: ${response.status} ${errorText}`)
      return null
    }

    const buffer = await response.arrayBuffer()
    const mediaType = getMediaType(fileName)

    // 对于文本文件，读取为文本
    if (isTextFile(fileName)) {
      const textContent = Buffer.from(buffer).toString('utf-8')
      return {
        type: 'file',
        name: fileName,
        text: textContent,
        mediaType,
      }
    }

    // 对于二进制文件，转为 Base64 Data URL
    const base64 = Buffer.from(buffer).toString('base64')
    const dataUrl = `data:${mediaType};base64,${base64}`
    return {
      type: 'file',
      url: dataUrl,
      name: fileName,
      mediaType,
    }
  } catch (error) {
    logger.error('FeishuAdapter', 'Error downloading file:', error)
    return null
  }
}

/**
 * 下载消息中的附件（图片/文件）
 */
async function downloadMessageAttachments(
  event: InboundEvent,
  config: ConnectorInboundConfig,
): Promise<MessageAttachment[]> {
  const attachments: MessageAttachment[] = []
  const token = await getFeishuToken(config)
  if (!token) return attachments

  const messageId = event.message.id
  const text = event.message.text || ''

  logger.debug('FeishuAdapter', `downloadMessageAttachments: type=${event.message.type}, text=${text.substring(0, 100)}`)

  if (event.message.type === 'image') {
    // text 字段就是 image_key
    logger.debug('FeishuAdapter', `Downloading image: ${text}`)
    const attachment = await downloadFeishuImage(messageId, text, token)
    if (attachment) attachments.push(attachment)
  } else if (event.message.type === 'file') {
    // text 字段是 file_key，需要从消息内容获取文件名
    logger.debug('FeishuAdapter', `Downloading file: ${text}`)
    const fileName = await getFileName(messageId, token) || text
    const attachment = await downloadFeishuFile(messageId, text, fileName, token)
    if (attachment) attachments.push(attachment)
  } else if (event.message.type === 'text' && text.startsWith('{')) {
    // 富文本消息，可能包含图片
    logger.debug('FeishuAdapter', `Processing rich text message`)
    const richTextAttachments = await downloadRichTextAttachments(event, token)
    attachments.push(...richTextAttachments)
  }

  logger.debug('FeishuAdapter', `downloadMessageAttachments result: ${attachments.length} attachments`)
  return attachments
}

/**
 * 获取消息中的文件名
 */
async function getFileName(messageId: string, token: string): Promise<string | null> {
  try {
    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) return null

    const data = await response.json() as { data?: { items?: Array<{ body?: { content?: string } }> } }
    const items = data.data?.items
    if (!items || items.length === 0) return null

    const content = items[0]?.body?.content
    if (!content) return null

    const contentObj = JSON.parse(content) as { file_name?: string }
    return contentObj.file_name || null
  } catch {
    return null
  }
}

/**
 * 下载富文本消息中的附件
 */
async function downloadRichTextAttachments(
  event: InboundEvent,
  token: string,
): Promise<MessageAttachment[]> {
  const attachments: MessageAttachment[] = []
  const text = event.message.text || ''

  try {
    const parsed = JSON.parse(text) as { text?: string; imageKeys?: string[] }
    logger.debug('FeishuAdapter', `Parsed rich text: text=${parsed.text}, imageKeys=${JSON.stringify(parsed.imageKeys)}`)

    if (parsed.imageKeys && parsed.imageKeys.length > 0) {
      for (const imageKey of parsed.imageKeys) {
        logger.debug('FeishuAdapter', `Downloading image from rich text: ${imageKey}`)
        const attachment = await downloadFeishuImage(event.message.id, imageKey, token)
        if (attachment) {
          logger.debug('FeishuAdapter', `Successfully downloaded image: ${imageKey}`)
          attachments.push(attachment)
        } else {
          logger.warn('FeishuAdapter', `Failed to download image: ${imageKey}`)
        }
      }
    }
  } catch (error) {
    logger.warn('FeishuAdapter', `Failed to parse rich text: ${error}`)
  }

  return attachments
}

// ---- Feishu Crypto ----

interface FeishuVerifyParams {
  timestamp: string
  nonce: string
  signature: string
  body: string
  encryptKey: string
}

interface FeishuDecryptedMessage {
  eventType: string
  event: unknown
  raw: unknown
}

function verifyFeishuSignature(params: FeishuVerifyParams): boolean {
  const content = params.timestamp + params.nonce + params.encryptKey + params.body
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  return hash === params.signature
}

function decryptFeishuMessage(encrypted: string, encryptKey: string): FeishuDecryptedMessage {
  const key = crypto.createHash('sha256').update(encryptKey).digest()
  const buf = Buffer.from(encrypted, 'base64')
  const iv = buf.slice(0, 16)
  const ciphertext = buf.slice(16)

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  const json = JSON.parse(decrypted.toString('utf-8'))
  return {
    eventType: json.type || json.event_type || '',
    event: json.event || json,
    raw: json,
  }
}

// ---- HTTP Adapter ----

export class FeishuHttpProtocolAdapter implements ProtocolAdapter {
  readonly protocol = 'feishu'

  async challenge(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundAcceptResult | null> {
    const bodyJson = parseJsonObject(input.body)
    if (!bodyJson) return null

    // 加密模式下 challenge 也在密文中，需先解密
    if (typeof bodyJson.encrypt === 'string') {
      const encryptKey = getCredential(config, 'encrypt_key', 'encryptKey')
      if (!encryptKey) return null
      try {
        const decrypted = decryptFeishuMessage(bodyJson.encrypt, encryptKey)
        const raw = decrypted.raw as Record<string, unknown>
        if (raw.type === 'url_verification' && typeof raw.challenge === 'string') {
          return {
            accepted: true,
            status: 200,
            body: { challenge: raw.challenge },
          }
        }
      } catch (error) {
        logger.warn('FeishuAdapter', 'Failed to decrypt challenge:', error)
      }
      return null
    }

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
    if (!bodyJson) return false

    // 未加密模式：校验 verification token（v1 body.token / v2 header.token）
    if (typeof bodyJson.encrypt !== 'string') {
      const verificationToken = getCredential(config, 'verification_token', 'verificationToken')
      if (!verificationToken) {
        logger.warn('FeishuAdapter', 'No verification_token configured; accepting unverified plaintext webhook. Configure verification_token to secure this endpoint.')
        return true
      }
      const header = bodyJson.header as Record<string, unknown> | undefined
      const bodyToken = (bodyJson.token as string) || (header?.token as string) || ''
      return bodyToken === verificationToken
    }

    const encryptKey = getCredential(config, 'encrypt_key', 'encryptKey')
    if (!encryptKey) return false

    return verifyFeishuSignature({
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
    const decrypted = decryptFeishuMessage(bodyJson.encrypt, encryptKey)

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

    // 只解析 envelope，附件下载延迟到 worker 侧 enrichFeishuEvent
    // （避免大附件下载阻塞 webhook 响应，超出飞书 3 秒时限）
    return feishuPayloadToInboundEvent(bodyJson, {
      connectorId: config.connectorId,
      transport: input.transport,
      receivedAt: input.receivedAt,
      raw: input.raw ?? bodyJson,
    })
  }
}

// ---- WebSocket Adapter ----

export class FeishuWsProtocolAdapter implements ProtocolAdapter {
  readonly protocol = 'feishu'

  async verify(): Promise<boolean> {
    return true
  }

  async parse(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundEvent> {
    const raw = input.raw
    if (!raw || typeof raw !== 'object') {
      throw new Error('INVALID_EXTERNAL_INPUT')
    }

    // 只解析 envelope，附件下载延迟到 worker 侧 enrichFeishuEvent
    return feishuPayloadToInboundEvent(raw as Record<string, unknown>, {
      connectorId: config.connectorId,
      transport: input.transport,
      receivedAt: input.receivedAt,
      raw,
    })
  }
}

/**
 * Worker 侧异步补全：下载消息中的附件（图片/文件）。
 * 在消息出队后、交给 Agent 前调用，失败会触发 inbox 重试。
 */
export async function enrichFeishuEvent(
  event: InboundEvent,
  config: ConnectorInboundConfig,
): Promise<InboundEvent> {
  if (event.message.type === 'image' || event.message.type === 'file' || event.message.type === 'text') {
    const attachments = await downloadMessageAttachments(event, config)
    if (attachments.length > 0) {
      event.message.attachments = attachments
    }
  }
  return event
}

// ---- Shared helpers ----

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

  // Debug logging
  logger.debug('FeishuAdapter', `messageType=${messageType}, content=${typeof message?.content === 'string' ? message.content.substring(0, 200) : 'non-string'}`)
  logger.debug('FeishuAdapter', `extracted text=${extractFeishuContent(messageType, message?.content).substring(0, 200)}`)

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
      type: mapFeishuMessageType(messageType),
      text: extractFeishuContent(messageType, message?.content),
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

function mapFeishuMessageType(type: string): 'text' | 'image' | 'file' | 'event' {
  if (type === 'text') return 'text'
  if (type === 'image') return 'image'
  if (type === 'post') return 'text'  // 富文本作为文本处理
  if (['file', 'audio', 'media'].includes(type)) return 'file'
  return 'event'
}

function extractFeishuContent(type: string, content: unknown): string {
  if (typeof content !== 'string') return ''
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    switch (type) {
      case 'text':
        return typeof parsed.text === 'string' ? parsed.text : ''
      case 'image':
        return typeof parsed.image_key === 'string' ? parsed.image_key : ''
      case 'file':
        return typeof parsed.file_key === 'string' ? parsed.file_key : ''
      case 'post':
        return extractPostContent(parsed)
      default:
        return typeof parsed.text === 'string' ? parsed.text : ''
    }
  } catch {
    return ''
  }
}

function extractPostContent(post: Record<string, unknown>): string {
  const content = post.content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  const imageKeys: string[] = []

  for (const paragraph of content) {
    if (!Array.isArray(paragraph)) continue
    for (const item of paragraph) {
      if (typeof item !== 'object' || item === null) continue
      const tag = (item as Record<string, unknown>).tag
      if (tag === 'text') {
        const text = (item as Record<string, unknown>).text
        if (typeof text === 'string') parts.push(text)
      } else if (tag === 'img') {
        const imageKey = (item as Record<string, unknown>).image_key
        if (typeof imageKey === 'string') imageKeys.push(imageKey)
      }
    }
  }

  // 返回 JSON 格式，包含文本和图片 keys
  return JSON.stringify({ text: parts.join(' '), imageKeys })
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
