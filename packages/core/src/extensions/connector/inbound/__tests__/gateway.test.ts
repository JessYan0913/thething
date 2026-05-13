import { describe, expect, it } from 'vitest'
import { ConnectorInboundGateway } from '../gateway/inbound-gateway'
import { InboundEventProcessor, type InboundEventHandler } from '../inbound-processor'
import { MemoryInboundInbox } from '../inbox/memory-inbox'
import { ConnectorResponder } from '../responder/responder'
import { DefaultConversationResolver } from '../../../../application/inbound-agent'
import type { InboundEvent } from '../types'
import type { ConnectorDefinition, ConnectorToolCall, ToolCallResponse } from '../../types'
import type { ConnectorRegistry } from '../../registry'

class FakeRegistry {
  calls: ConnectorToolCall[] = []
  private connectors = new Map<string, ConnectorDefinition>()

  constructor(connectors: ConnectorDefinition[]) {
    for (const connector of connectors) {
      this.connectors.set(connector.id, connector)
    }
  }

  getDefinition(connectorId: string): ConnectorDefinition | undefined {
    return this.connectors.get(connectorId)
  }

  getConnectorIds(): string[] {
    return [...this.connectors.keys()]
  }

  async callTool(request: ConnectorToolCall): Promise<ToolCallResponse> {
    this.calls.push(request)
    return { success: true, result: { ok: true } }
  }
}

describe('connector inbound gateway', () => {
  it('accepts duplicate external ids without publishing twice', async () => {
    const inbox = new MemoryInboundInbox()
    const received: InboundEvent[] = []
    inbox.subscribe(async (event) => {
      received.push(event)
    })

    const gateway = new ConnectorInboundGateway({
      registry: new FakeRegistry([testConnector('test-service', 'test-service')]) as unknown as ConnectorRegistry,
      inbox,
    })

    const body = JSON.stringify({
      message_id: 'same-message',
      channel_id: 'channel-1',
      sender_id: 'user-1',
      content: 'hello',
    })

    const first = await gateway.acceptHttp({
      method: 'POST',
      path: '/api/connector/webhooks/test-service',
      connectorId: 'test-service',
      params: { connectorId: 'test-service' },
      query: {},
      headers: {},
      body,
    })
    const second = await gateway.acceptHttp({
      method: 'POST',
      path: '/api/connector/webhooks/test-service',
      connectorId: 'test-service',
      params: { connectorId: 'test-service' },
      query: {},
      headers: {},
      body,
    })

    await Promise.resolve()

    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(true)
    expect(second.reason).toBe('duplicate')
    expect(received).toHaveLength(1)
    expect(received[0].connectorId).toBe('test-service')
  })

  it('normalizes feishu http and websocket payloads to the same shape', async () => {
    const registry = new FakeRegistry([testConnector('feishu', 'feishu')]) as unknown as ConnectorRegistry
    const httpGateway = new ConnectorInboundGateway({
      registry,
      inbox: new MemoryInboundInbox(),
    })
    const wsGateway = new ConnectorInboundGateway({
      registry,
      inbox: new MemoryInboundInbox(),
    })

    const httpEvents: InboundEvent[] = []
    const wsEvents: InboundEvent[] = []
    ;(httpGateway as unknown as { options: { inbox: MemoryInboundInbox } }).options.inbox.subscribe(async event => {
      httpEvents.push(event)
    })
    ;(wsGateway as unknown as { options: { inbox: MemoryInboundInbox } }).options.inbox.subscribe(async event => {
      wsEvents.push(event)
    })

    const payload = feishuPayload()
    await httpGateway.acceptHttp({
      method: 'POST',
      path: '/api/connector/webhooks/feishu',
      connectorId: 'feishu',
      params: { connectorId: 'feishu' },
      query: {},
      headers: {},
      body: JSON.stringify(payload),
    })
    await wsGateway.acceptExternal({
      connectorId: 'feishu',
      protocol: 'feishu',
      transport: 'websocket',
      raw: payload.event,
    })

    await Promise.resolve()

    expect(httpEvents[0].connectorId).toBe('feishu')
    expect(wsEvents[0].connectorId).toBe('feishu')
    expect(httpEvents[0].channel.id).toBe(wsEvents[0].channel.id)
    expect(httpEvents[0].message.text).toBe(wsEvents[0].message.text)
    expect(httpEvents[0].replyAddress.messageId).toBe(wsEvents[0].replyAddress.messageId)
  })

  it('responder uses replyAddress connectorId instead of protocol as connector identity', async () => {
    const registry = new FakeRegistry([testConnector('feishu-work', 'feishu')])
    const responder = new ConnectorResponder({ registry: registry as unknown as ConnectorRegistry })

    const result = await responder.respond({
      connectorId: 'feishu-work',
      protocol: 'feishu',
      channelId: 'chat-1',
      messageId: 'msg-1',
    }, {
      type: 'text',
      text: 'ok',
    })

    expect(result.success).toBe(true)
    expect(registry.calls[0]).toMatchObject({
      connectorId: 'feishu-work',
      toolName: 'reply_message',
      input: {
        text: 'ok',
      },
    })
  })

  it('conversation resolver namespaces connector conversations', async () => {
    const resolver = new DefaultConversationResolver()
    await expect(resolver.resolve({
      id: 'event-1',
      connectorId: 'feishu-work',
      protocol: 'feishu',
      transport: 'test',
      externalEventId: 'external-1',
      channel: { id: 'chat-1' },
      sender: { id: 'user-1', type: 'user' },
      message: { id: 'msg-1', type: 'text', text: 'hello' },
      replyAddress: {
        connectorId: 'feishu-work',
        protocol: 'feishu',
        channelId: 'chat-1',
        messageId: 'msg-1',
      },
      receivedAt: 1,
    })).resolves.toBe('connector:feishu-work:channel:chat-1')
  })

  it('connector approval response detection stays inside connector processing', async () => {
    const handled: InboundEvent[] = []
    const processor = new InboundEventProcessor()
    processor.setHandler({
      async handle(event) {
        handled.push(event)
        return { success: true }
      },
    } satisfies InboundEventHandler)

    await processor.handle({
      id: 'approval-event',
      connectorId: 'test-service',
      protocol: 'test-service',
      transport: 'test',
      externalEventId: 'approval-message',
      channel: { id: 'channel-1' },
      sender: { id: 'user-1', type: 'user' },
      message: { id: 'approval-message', type: 'text', text: '同意' },
      replyAddress: {
        connectorId: 'test-service',
        protocol: 'test-service',
        channelId: 'channel-1',
        messageId: 'approval-message',
      },
      receivedAt: 1,
    })

    expect(handled).toHaveLength(1)
    expect(handled[0].message.text).toBe('同意')
  })
})

function testConnector(id: string, protocol: string): ConnectorDefinition {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: id,
    enabled: true,
    inbound: {
      enabled: true,
      webhookPath: `/api/connector/webhooks/${id}`,
      protocol,
      reply: {
        tool: protocol === 'feishu' ? 'reply_message' : 'send_message',
        input: {
          reply_context: {
            connector_type: '$replyAddress.protocol',
            channel_id: '$replyAddress.channelId',
            reply_to_message_id: '$replyAddress.messageId',
          },
          text: '$message.text',
        },
      },
    },
    auth: { type: 'none', config: {} },
    credentials: {},
    tools: [{
      name: protocol === 'feishu' ? 'reply_message' : 'send_message',
      description: 'reply',
      input_schema: { type: 'object', properties: {} },
      executor: 'mock',
      executor_config: { response: { ok: true } },
    }],
  }
}

function feishuPayload() {
  return {
    header: {
      event_id: 'event-1',
      create_time: '123',
    },
    event: {
      sender: {
        sender_type: 'user',
        sender_id: { open_id: 'open-1' },
      },
      message: {
        message_id: 'msg-1',
        chat_id: 'chat-1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
      },
    },
  }
}
