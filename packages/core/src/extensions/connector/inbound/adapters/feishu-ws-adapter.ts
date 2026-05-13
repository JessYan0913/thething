import type { AdapterInput, ConnectorInboundConfig, InboundEvent } from '../types'
import type { ProtocolAdapter } from './protocol-adapter'
import { feishuPayloadToInboundEvent } from './feishu-http-adapter'

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

    return feishuPayloadToInboundEvent(raw as Record<string, unknown>, {
      connectorId: config.connectorId,
      transport: input.transport,
      receivedAt: input.receivedAt,
      raw,
    })
  }
}

