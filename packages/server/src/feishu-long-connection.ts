// ============================================================
// Feishu Long Connection - WebSocket 长连接模式
// ============================================================
// 使用飞书官方 SDK 的 WSClient，无需公网域名
// 消息接收走 WebSocket，回复走 HTTP REST API

import * as Lark from '@larksuiteoapi/node-sdk'
import {
  type ConnectorRegistry,
  type ConnectorInboundRuntime,
} from '@the-thing/core'

interface FeishuWsConnection {
  connectorId: string
  wsClient: Lark.WSClient
  client: Lark.Client
}

let connections: FeishuWsConnection[] = []
let inboundRuntime: ConnectorInboundRuntime | null = null

/**
 * 启动飞书长连接
 *
 * 通过 WebSocket 与飞书建立全双工通道，接收消息事件。
 * 需要环境变量：FEISHU_APP_ID, FEISHU_APP_SECRET
 */
export async function startFeishuLongConnection(
  registry: ConnectorRegistry,
  runtime?: ConnectorInboundRuntime | null,
): Promise<void> {
  inboundRuntime = runtime ?? inboundRuntime
  const configs = resolveFeishuWsConfigs(registry)

  if (configs.length === 0) {
    console.log('[FeishuWS] No enabled feishu websocket connector found, skipping')
    return
  }

  for (const config of configs) {
    const { connectorId, appId, appSecret } = config
    if (connections.some(connection => connection.connectorId === connectorId)) {
      console.log('[FeishuWS] Long connection already started, skipping:', connectorId)
      continue
    }

    if (!appId || !appSecret) {
      console.warn('[FeishuWS] Missing app_id/app_secret, skipping connector:', connectorId)
      continue
    }

    const baseConfig = { appId, appSecret }

    const client = new Lark.Client(baseConfig)
    const wsClient = new Lark.WSClient({
      ...baseConfig,
      loggerLevel: Lark.LoggerLevel.info,
    })

    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: Record<string, unknown>) => {
        try {
          await handleMessage(connectorId, data)
        } catch (err) {
          console.error('[FeishuWS] Message handling error:', connectorId, err)
        }
      },
    })

    wsClient.start({ eventDispatcher })
    connections.push({ connectorId, wsClient, client })
    console.log('[FeishuWS] Long connection started:', connectorId)
  }
}

/**
 * 停止飞书长连接
 */
export function stopFeishuLongConnection(): void {
  if (connections.length > 0) {
    for (const connection of connections) {
      connection.wsClient.close()
    }
    connections = []
    inboundRuntime = null
    console.log('[FeishuWS] Long connections stopped')
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
async function handleMessage(connectorId: string, data: Record<string, unknown>): Promise<void> {
  if (!data.sender || !data.message) {
    console.warn('[FeishuWS] Invalid event: missing sender or message')
    return
  }

  if (inboundRuntime) {
    const result = await inboundRuntime.gateway.acceptExternal({
      connectorId,
      protocol: 'feishu',
      transport: 'websocket',
      raw: data,
    })
    if (!result.accepted) {
      console.warn('[FeishuWS] Gateway rejected event:', result.reason)
    }
  } else {
    console.warn('[FeishuWS] Connector inbound runtime not initialized, message dropped')
  }
}

function resolveFeishuWsConfigs(registry: ConnectorRegistry): Array<{
  connectorId: string
  appId: string
  appSecret: string
}> {
  const configs: Array<{ connectorId: string; appId: string; appSecret: string }> = []

  for (const connectorId of registry.getConnectorIds()) {
    const connector = registry.getDefinition(connectorId)
    if (!connector?.enabled || !connector.inbound?.enabled) continue

    const protocol = connector.inbound.protocol
    const transports = connector.inbound.transports
    const supportsWebsocket = !transports || transports.includes('websocket')
    if (protocol !== 'feishu' || !supportsWebsocket) continue

    configs.push({
      connectorId,
      appId: connector.credentials?.app_id || process.env.FEISHU_APP_ID || '',
      appSecret: connector.credentials?.app_secret || process.env.FEISHU_APP_SECRET || '',
    })
  }

  return configs
}
