// ============================================================
// Feishu WebSocket 长连接客户端
// ============================================================
//
// 使用飞书官方 SDK 建立 WebSocket 长连接，接收事件并注入 inbound pipeline。
// 飞书后台需配置为"长连接"模式。

import * as Lark from '@larksuiteoapi/node-sdk'
import { logger } from '../../../primitives/logger'
import type { ConnectorInboundRuntime } from './types'

export interface FeishuWsClientConfig {
  appId: string
  appSecret: string
  connectorId?: string
}

export class FeishuWsClient {
  private wsClient: Lark.WSClient | null = null
  private client: Lark.Client | null = null
  private running = false

  constructor(
    private readonly config: FeishuWsClientConfig,
    private readonly inboundRuntime: ConnectorInboundRuntime,
  ) {}

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('FeishuWsClient', 'Already running')
      return
    }

    const { appId, appSecret } = this.config
    if (!appId || !appSecret) {
      logger.error('FeishuWsClient', 'Missing appId or appSecret')
      return
    }

    logger.info('FeishuWsClient', `Starting WebSocket client for app: ${appId}`)

    this.client = new Lark.Client({ appId, appSecret })

    this.wsClient = new Lark.WSClient({
      appId,
      appSecret,
      loggerLevel: Lark.LoggerLevel.info,
    })

    const connectorId = this.config.connectorId || 'feishu'

    this.wsClient.start({
      eventDispatcher: new Lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
          await this.handleMessage(data, connectorId)
        },
      }),
    })

    this.running = true
    logger.info('FeishuWsClient', 'WebSocket client started')
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    this.wsClient = null
    this.client = null
    logger.info('FeishuWsClient', 'WebSocket client stopped')
  }

  private async handleMessage(data: unknown, connectorId: string): Promise<void> {
    try {
      const eventData = data as Record<string, unknown>
      const header = eventData.header as Record<string, unknown> | undefined
      const event = eventData.event as Record<string, unknown> | undefined

      logger.debug('FeishuWsClient', `Received event: ${header?.event_type || 'unknown'}`, {
        eventId: header?.event_id,
      })

      // Build the full Feishu event envelope for the adapter parser
      const fullPayload: Record<string, unknown> = {
        header: header ?? {
          event_id: `ws-${Date.now()}`,
          event_type: 'im.message.receive_v1',
          create_time: String(Date.now()),
          token: '',
          app_id: this.config.appId,
          tenant_key: '',
        },
        event: event ?? eventData,
      }

      const result = await this.inboundRuntime.gateway.acceptExternal({
        connectorId,
        protocol: 'feishu',
        transport: 'websocket',
        raw: fullPayload,
        receivedAt: Date.now(),
      })

      if (!result.accepted) {
        logger.warn('FeishuWsClient', `Event rejected: ${result.reason}`, { eventId: result.eventId })
      }
    } catch (error) {
      logger.error('FeishuWsClient', 'Error handling message:', error)
    }
  }
}
