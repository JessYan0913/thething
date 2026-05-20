import type { AdapterInput, ConnectorInboundConfig, InboundEvent } from '../types'
import type { ProtocolAdapter } from './protocol-adapter'

export class TestProtocolAdapter implements ProtocolAdapter {
  readonly protocol = 'test-service'

  async verify(): Promise<boolean> {
    return true
  }

  async parse(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundEvent> {
    const body = parseObject(input)
    const channelId = (body.channel_id as string) || 'webhook-test'
    const messageId = (body.message_id as string) || `msg-${input.receivedAt}`
    const externalEventId = (body.event_id as string) || messageId
    const messageType = (body.message_type as string) || 'text'

    return {
      id: `${config.connectorId}:${input.transport}:${externalEventId}`,
      connectorId: config.connectorId,
      protocol: config.protocol || this.protocol,
      transport: input.transport,
      externalEventId,
      channel: { id: channelId },
      sender: {
        id: (body.sender_id as string) || 'webhook-caller',
        name: (body.sender_name as string) || 'Webhook Caller',
        type: 'user',
      },
      message: {
        id: messageId,
        type: messageType,
        text: (body.content as string) || input.body || '',
        raw: body,
      },
      replyAddress: {
        connectorId: config.connectorId,
        protocol: config.protocol || this.protocol,
        channelId,
        messageId,
        raw: body,
      },
      receivedAt: input.receivedAt,
    }
  }
}

function parseObject(input: AdapterInput): Record<string, unknown> {
  if (input.raw && typeof input.raw === 'object') {
    return input.raw as Record<string, unknown>
  }

  if (!input.body) return {}

  try {
    const parsed = JSON.parse(input.body)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return { content: input.body }
  }
}
