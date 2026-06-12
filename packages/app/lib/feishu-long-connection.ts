// ============================================================
// Feishu Long Connection - WebSocket 长连接模式
// ============================================================
// 使用飞书官方 SDK 的 WSClient，无需公网域名
// 消息接收走 WebSocket，回复走 HTTP REST API

import * as Lark from '@larksuiteoapi/node-sdk'
import type { ConnectorRegistry, ExternalInboundInput, InboundAcceptResult } from '@the-thing/core'

// 存储多个飞书长连接实例
const wsClients = new Map<string, Lark.WSClient>()
const larkClients = new Map<string, Lark.Client>()

/**
 * 启动飞书长连接
 *
 * @param connectorId - connector 实例 ID（可选，默认为 'feishu'）
 * @param registry - ConnectorRegistry 实例
 * @param gateway - ConnectorInboundGateway 实例
 */
export async function startFeishuLongConnection(
  connectorId: string | undefined,
  registry: ConnectorRegistry,
  gateway: { acceptExternal: (input: ExternalInboundInput) => Promise<InboundAcceptResult> }
): Promise<void> {
  const effectiveConnectorId = connectorId || 'feishu'

  // 从 Registry 获取配置
  const connector = registry.getDefinition(effectiveConnectorId)
  if (!connector) {
    console.log(`[FeishuWS] Connector '${effectiveConnectorId}' not found in registry, skipping`)
    return
  }

  if (!connector.enabled) {
    console.log(`[FeishuWS] Connector '${effectiveConnectorId}' is disabled, skipping`)
    return
  }

  const credentials = connector.variables || {}
  const appId = credentials.app_id || credentials.appId || ''
  const appSecret = credentials.app_secret || credentials.appSecret || ''

  if (!appId || !appSecret) {
    console.log(`[FeishuWS] Connector '${effectiveConnectorId}' missing app_id/app_secret in variables, skipping`)
    return
  }

  // 检查是否已启动
  if (wsClients.has(effectiveConnectorId)) {
    console.log(`[FeishuWS] Connector '${effectiveConnectorId}' already started`)
    return
  }

  const baseConfig = { appId, appSecret }

  // 创建 Client（用于 API 调用）
  const client = new Lark.Client(baseConfig)
  larkClients.set(effectiveConnectorId, client)

  // 创建 WSClient
  const wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  })

  // 注册事件处理器
  const eventDispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: Record<string, unknown>) => {
      try {
        await handleMessage(data, effectiveConnectorId, gateway)
      } catch (err) {
        console.error(`[FeishuWS:${effectiveConnectorId}] Error handling message:`, err)
      }
    },
  })

  // 启动长连接
  wsClient.start({ eventDispatcher })
  wsClients.set(effectiveConnectorId, wsClient)

  console.log(`[FeishuWS:${effectiveConnectorId}] Long connection started`)
}

/**
 * 启动所有飞书 WebSocket connector
 */
export async function startAllFeishuLongConnections(
  registry: ConnectorRegistry,
  gateway: { acceptExternal: (input: ExternalInboundInput) => Promise<InboundAcceptResult> }
): Promise<void> {
  const connectorIds = registry.getConnectorIds()

  for (const connectorId of connectorIds) {
    const connector = registry.getDefinition(connectorId)
    if (!connector?.inbound?.enabled) continue

    const protocol = connector.inbound.protocol
    const transports = connector.inbound.transports || []

    // 检查是否为飞书协议且支持 WebSocket
    if (protocol === 'feishu' && (transports.includes('websocket') || transports.includes('ws'))) {
      await startFeishuLongConnection(connectorId, registry, gateway)
    }
  }
}

/**
 * 停止飞书长连接
 */
export function stopFeishuLongConnection(connectorId?: string): void {
  const effectiveConnectorId = connectorId || 'feishu'

  if (wsClients.has(effectiveConnectorId)) {
    wsClients.delete(effectiveConnectorId)
    larkClients.delete(effectiveConnectorId)
    console.log(`[FeishuWS:${effectiveConnectorId}] Long connection stopped`)
  }
}

/**
 * 停止所有飞书长连接
 */
export function stopAllFeishuLongConnections(): void {
  for (const connectorId of wsClients.keys()) {
    stopFeishuLongConnection(connectorId)
  }
}

/**
 * 获取飞书 Client（用于 API 调用）
 */
export function getFeishuClient(connectorId?: string): Lark.Client | null {
  const effectiveConnectorId = connectorId || 'feishu'
  return larkClients.get(effectiveConnectorId) || null
}

/**
 * 处理飞书消息事件
 *
 * 将原始飞书事件数据通过 ConnectorInboundGateway 的 acceptExternal()
 * 推入入站处理流程，由 FeishuWsProtocolAdapter 自动解析为标准 InboundEvent。
 */
async function handleMessage(
  data: Record<string, unknown>,
  connectorId: string,
  gateway: { acceptExternal: (input: ExternalInboundInput) => Promise<InboundAcceptResult> }
): Promise<void> {
  const result = await gateway.acceptExternal({
    connectorId,
    protocol: 'feishu',
    transport: 'websocket',
    raw: data,
    receivedAt: Date.now(),
  })

  if (result.accepted) {
    console.log(`[FeishuWS:${connectorId}] Event accepted:`, result.eventId)
  } else {
    console.warn(`[FeishuWS:${connectorId}] Event rejected: ${result.reason}`)
  }
}

/**
 * 检查飞书长连接是否已启动
 */
export function isFeishuLongConnectionStarted(connectorId?: string): boolean {
  const effectiveConnectorId = connectorId || 'feishu'
  return wsClients.has(effectiveConnectorId)
}

/**
 * 获取已启动的飞书长连接列表
 */
export function getStartedFeishuConnections(): string[] {
  return Array.from(wsClients.keys())
}
