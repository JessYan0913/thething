import type { ConnectorRegistry } from '../../registry'
import type {
  AdapterInput,
  ConnectorInboundConfig,
  ExternalInboundInput,
  InboundAcceptResult,
  InboundInbox,
} from '../types'
import { FeishuHttpProtocolAdapter } from '../adapters/feishu-http-adapter'
import { FeishuWsProtocolAdapter } from '../adapters/feishu-ws-adapter'
import { TestProtocolAdapter } from '../adapters/test-adapter'
import { isWechatProtocol, WechatProtocolAdapter } from '../adapters/wechat-adapter'
import type { ProtocolAdapter } from '../adapters/protocol-adapter'
import type { InboundHttpRequest } from './http-request'

export interface ConnectorInboundGatewayOptions {
  registry: ConnectorRegistry
  inbox: InboundInbox
  adapters?: ProtocolAdapter[]
}

export class ConnectorInboundGateway {
  private readonly adapters = new Map<string, ProtocolAdapter>()

  constructor(private readonly options: ConnectorInboundGatewayOptions) {
    for (const adapter of [
      new FeishuHttpProtocolAdapter(),
      new TestProtocolAdapter(),
      new WechatProtocolAdapter('wecom'),
      new WechatProtocolAdapter('wechat-mp'),
      new WechatProtocolAdapter('wechat-kf'),
      ...(options.adapters ?? []),
    ]) {
      this.adapters.set(adapter.protocol, adapter)
    }
  }

  async acceptHttp(request: InboundHttpRequest): Promise<InboundAcceptResult> {
    const resolved = this.resolveHttpConfig(request)
    if (!resolved) {
      return {
        accepted: false,
        status: 404,
        reason: 'CONNECTOR_NOT_FOUND',
        body: { success: false, error: 'Connector inbound config not found' },
      }
    }

    const input: AdapterInput = {
      connectorId: resolved.config.connectorId,
      protocol: resolved.config.protocol,
      transport: request.transport || 'http',
      query: request.query,
      headers: normalizeHeaders(request.headers),
      body: request.body,
      receivedAt: Date.now(),
    }

    return this.acceptWithAdapter(input, resolved.config, resolved.adapter)
  }

  async acceptExternal(input: ExternalInboundInput): Promise<InboundAcceptResult> {
    const config = this.buildConfig(input.connectorId, input.protocol)
    if (!config) {
      return {
        accepted: false,
        status: 404,
        reason: 'CONNECTOR_NOT_FOUND',
        body: { success: false, error: `Connector not found: ${input.connectorId}` },
      }
    }

    const adapter = this.getAdapter(input.protocol, input.transport)
    if (!adapter) {
      return {
        accepted: false,
        status: 400,
        reason: 'ADAPTER_NOT_FOUND',
        body: { success: false, error: `No inbound adapter for protocol: ${input.protocol}` },
      }
    }

    return this.acceptWithAdapter({
      connectorId: input.connectorId,
      protocol: input.protocol,
      transport: input.transport,
      query: input.query ?? {},
      headers: normalizeHeaders(input.headers ?? {}),
      raw: input.raw,
      receivedAt: input.receivedAt ?? Date.now(),
    }, config, adapter)
  }

  private async acceptWithAdapter(
    input: AdapterInput,
    config: ConnectorInboundConfig,
    adapter: ProtocolAdapter,
  ): Promise<InboundAcceptResult> {
    const challenge = await adapter.challenge?.(input, config)
    if (challenge) return challenge

    const verified = await adapter.verify(input, config)
    if (!verified) {
      return {
        accepted: false,
        status: 400,
        reason: 'SIGNATURE_INVALID',
        body: { success: false, error: 'SIGNATURE_INVALID' },
      }
    }

    const parsedInput = adapter.decrypt ? await adapter.decrypt(input, config) : input
    const event = await adapter.parse(parsedInput, config)

    const published = await this.options.inbox.publish(event)
    if (!published.accepted && published.reason !== 'duplicate') {
      return {
        accepted: false,
        status: published.reason === 'queue_full' ? 503 : 500,
        eventId: event.id,
        reason: published.reason,
        body: { success: false, event_id: event.id, error: published.reason },
      }
    }

    return {
      accepted: true,
      status: 200,
      eventId: event.id,
      reason: published.reason,
      body: { success: true, event_id: event.id },
    }
  }

  private resolveHttpConfig(request: InboundHttpRequest): {
    config: ConnectorInboundConfig
    adapter: ProtocolAdapter
  } | null {
    const explicitConnectorId = request.connectorId || request.params?.connectorId
    const connectorId = explicitConnectorId || inferConnectorIdFromPath(request.path)
    if (!connectorId) return null

    const protocol = request.protocol || this.getProtocolForConnector(connectorId)
    if (!protocol) return null

    const config = this.buildConfig(connectorId, protocol)
    if (!config) return null

    const adapter = this.getAdapter(protocol, request.transport || 'http')
    if (!adapter) return null

    return { config, adapter }
  }

  private buildConfig(connectorId: string, protocol: string): ConnectorInboundConfig | null {
    const connector = this.options.registry.getDefinition(connectorId)
    if (
      !connector ||
      !connector.enabled ||
      !connector.inbound?.enabled ||
      connector.inbound.protocol !== protocol
    ) {
      return null
    }

    return {
      connectorId,
      protocol,
      credentials: connector.credentials || {},
      inbound: connector.inbound,
      connector,
    }
  }

  private getAdapter(protocol: string, transport: string): ProtocolAdapter | null {
    if (protocol === 'feishu' && transport === 'websocket') {
      return new FeishuWsProtocolAdapter()
    }
    if (isWechatProtocol(protocol)) {
      return this.adapters.get(protocol) ?? null
    }
    return this.adapters.get(protocol) ?? null
  }

  private getProtocolForConnector(connectorId: string): string | null {
    const connector = this.options.registry.getDefinition(connectorId)
    return connector?.inbound?.protocol ?? null
  }
}

function inferConnectorIdFromPath(path: string): string | undefined {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1]
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value
  }
  return normalized
}
