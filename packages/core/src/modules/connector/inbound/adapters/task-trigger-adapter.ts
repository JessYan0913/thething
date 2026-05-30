// ============================================================
// Task Trigger Protocol Adapter
// ============================================================
//
// This adapter does not schedule jobs by itself. It accepts a payload from an
// external scheduler/task service and converts it into a standard InboundEvent.

import type { AdapterInput, ConnectorInboundConfig, InboundEvent } from '../types'
import type { ProtocolAdapter } from './protocol-adapter'

export class TaskTriggerProtocolAdapter implements ProtocolAdapter {
  readonly protocol = 'task-trigger'

  async verify(_input: AdapterInput, _config: ConnectorInboundConfig): Promise<boolean> {
    return true
  }

  async parse(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundEvent> {
    const body = parseObject(input)
    const message = extractMessageText(body)
    const agentType = getString(body, 'agentType', 'agent_type')
    const executionId = getString(body, 'executionId', 'execution_id', 'conversationId', 'conversation_id')
      || input.headers['x-execution-id']
    const channelId = executionId || getString(body, 'channel_id', 'channelId') || 'task-trigger'
    const senderId = getString(body, 'senderId', 'sender_id') || 'task-trigger'
    const externalEventId = getString(body, 'eventId', 'event_id', 'id')
      || `task-trigger-${Date.now()}`

    return {
      id: `${config.connectorId}:${input.transport}:${externalEventId}`,
      connectorId: config.connectorId,
      protocol: 'task-trigger',
      transport: input.transport,
      externalEventId,
      channel: {
        id: channelId,
        type: 'task-trigger',
      },
      sender: {
        id: senderId,
        type: 'bot',
      },
      message: {
        id: externalEventId,
        type: 'text',
        text: message,
        raw: input.raw ?? body,
      },
      replyAddress: {
        connectorId: config.connectorId,
        protocol: 'task-trigger',
        channelId,
        messageId: externalEventId,
        raw: body,
      },
      receivedAt: input.receivedAt,
      agentType: agentType || undefined,
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
    return { message: input.body }
  }
}

function extractMessageText(body: Record<string, unknown>): string {
  const message = body.message
  if (typeof message === 'string') return message

  if (message && typeof message === 'object') {
    const parts = (message as { parts?: unknown }).parts
    if (Array.isArray(parts)) {
      const textPart = parts.find((part) => {
        return part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
      })
      const text = (textPart as { text?: unknown } | undefined)?.text
      if (typeof text === 'string') return text
    }
  }

  return ''
}

function getString(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number') return String(value)
  }
  return ''
}
