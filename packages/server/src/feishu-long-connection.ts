// ============================================================
// Feishu Long Connection - WebSocket 长连接模式
// ============================================================
// 使用飞书官方 SDK 的 WSClient，无需公网域名
// 消息接收走 WebSocket，回复走 HTTP REST API

import * as Lark from '@larksuiteoapi/node-sdk'
import { inboundEventQueue, getIdempotencyGuard } from '@the-thing/core'
import type { InboundMessageEvent } from '@the-thing/core'

let wsClient: Lark.WSClient | null = null
let client: Lark.Client | null = null

/**
 * 启动飞书长连接
 *
 * 通过 WebSocket 与飞书建立全双工通道，接收消息事件。
 * 需要环境变量：FEISHU_APP_ID, FEISHU_APP_SECRET
 */
export async function startFeishuLongConnection(): Promise<void> {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET

  if (!appId || !appSecret) {
    console.log('[FeishuWS] FEISHU_APP_ID or FEISHU_APP_SECRET not set, skipping')
    return
  }

  const baseConfig = { appId, appSecret }

  // 创建 Client（用于 API 调用，如发消息）
  client = new Lark.Client(baseConfig)

  // 创建 WSClient（长连接）
  wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  })

  // 注册事件处理器
  const eventDispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: Record<string, unknown>) => {
      try {
        await handleMessage(data)
      } catch (err) {
        console.error('[FeishuWS] Message handling error:', err)
      }
    },
  })

  // 启动长连接
  wsClient.start({ eventDispatcher })
  console.log('[FeishuWS] Long connection started')
}

/**
 * 停止飞书长连接
 */
export function stopFeishuLongConnection(): void {
  if (wsClient) {
    // WSClient 没有显式 close 方法，置空引用即可
    wsClient = null
    client = null
    console.log('[FeishuWS] Long connection stopped')
  }
}

/**
 * 处理飞书消息事件
 *
 * 飞书 SDK 的 im.message.receive_v1 事件结构：
 * {
 *   sender: { sender_id: { open_id, user_id }, sender_type },
 *   message: { message_id, root_id, parent_id, create_time, chat_id, chat_type, message_type, content }
 * }
 */
async function handleMessage(data: Record<string, unknown>): Promise<void> {
  const sender = data.sender as Record<string, unknown> | undefined
  const message = data.message as Record<string, unknown> | undefined

  if (!sender || !message) {
    console.warn('[FeishuWS] Invalid event: missing sender or message')
    return
  }

  const senderId = ((sender.sender_id as Record<string, unknown>)?.open_id as string) || ''
  const senderType = (sender.sender_type as string) || 'user'
  const messageId = (message.message_id as string) || ''
  const chatId = (message.chat_id as string) || ''
  const messageType = (message.message_type as string) || 'text'
  const createTime = (message.create_time as string) || String(Date.now())

  // 解析消息内容
  let contentText = ''
  if (message.content) {
    try {
      const contentJson = JSON.parse(message.content as string)
      contentText = contentJson.text || ''
    } catch {
      contentText = message.content as string
    }
  }

  // 幂等检查
  const isDuplicate = await getIdempotencyGuard().isDuplicate(messageId, 'feishu')
  if (isDuplicate) {
    console.log('[FeishuWS] Duplicate message skipped:', messageId)
    return
  }

  // 构建 InboundMessageEvent
  const event: InboundMessageEvent = {
    event_id: `feishu-ws-${Date.now()}-${messageId}`,
    connector_type: 'feishu',
    channel_id: chatId,
    sender: {
      id: senderId,
      type: senderType === 'user' ? 'user' : 'bot',
    },
    message: {
      id: messageId,
      type: messageType === 'text' ? 'text' : 'event',
      text: contentText,
      raw: data,
    },
    timestamp: parseInt(createTime) || Date.now(),
    reply_context: {
      connector_type: 'feishu',
      channel_id: chatId,
      reply_to_message_id: messageId,
    },
  }

  // 推入事件队列
  await inboundEventQueue.push(event)
}
