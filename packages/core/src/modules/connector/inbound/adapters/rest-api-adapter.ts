// ============================================================
// REST API Protocol Adapter
// ============================================================
//
// Generic REST API inbound adapter. Parses any HTTP JSON body
// into an InboundEvent, making all body fields available via
// $replyAddress.raw.* and $message.raw.* for reply templates.
//
// Authentication: when the connector declares a `webhook_secret`
// (or `webhookSecret`) variable, requests must carry it as
// `Authorization: Bearer <secret>` or `X-Webhook-Secret: <secret>`.
// Without the variable, all requests are accepted (with a warning).

import type { AdapterInput, ConnectorInboundConfig, InboundEvent, ProtocolAdapter } from '../types'
import crypto from 'crypto'
import { logger } from '../../../../primitives/logger'

export class RestApiProtocolAdapter implements ProtocolAdapter {
  readonly protocol = 'rest-api'

  async verify(input: AdapterInput, config: ConnectorInboundConfig): Promise<boolean> {
    const secret = config.credentials.webhook_secret || config.credentials.webhookSecret
    if (!secret) {
      logger.warn('RestApiAdapter', `Connector '${config.connectorId}' has no webhook_secret configured; accepting unauthenticated webhook. Set webhook_secret variable to secure this endpoint.`)
      return true
    }

    const authHeader = input.headers['authorization'] || ''
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const headerSecret = input.headers['x-webhook-secret'] || ''
    const provided = bearerToken || headerSecret
    if (!provided) return false

    const expected = Buffer.from(secret)
    const actual = Buffer.from(provided)
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  }

  async parse(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundEvent> {
    const body = parseBody(input)
    const method = input.method || 'POST'
    const path = input.path || '/'

    // Deterministic externalEventId: use requestId/request_id/id from body, or hash
    const requestId = getString(body, 'requestId', 'request_id', 'id')
    const externalEventId = requestId || `rest-api-${method}-${hashRequest(method, path, body)}`

    // Channel ID = same as externalEventId for conversation dedup
    const channelId = requestId || externalEventId

    // Sender info
    const senderId = getString(body, 'senderId', 'sender_id', 'sender') || 'rest-api-client'
    const senderName = getString(body, 'senderName', 'sender_name') || 'REST API Client'

    // Message text: extract from body.text / body.message / body.content
    const messageText = extractMessageText(body)
    const messageId = externalEventId

    // Build raw payload with body fields + HTTP metadata
    const rawPayload: Record<string, unknown> = {
      ...body,
      _method: method,
      _path: path,
      _query: input.query,
      _headers: input.headers,
    }

    return {
      id: `${config.connectorId}:${input.transport}:${externalEventId}`,
      connectorId: config.connectorId,
      protocol: 'rest-api',
      transport: input.transport,
      externalEventId,
      channel: {
        id: channelId,
        type: 'rest-api',
      },
      sender: {
        id: senderId,
        name: senderName,
        type: 'bot',
      },
      message: {
        id: messageId,
        type: 'text',
        text: messageText,
        raw: rawPayload,
      },
      replyAddress: {
        connectorId: config.connectorId,
        protocol: 'rest-api',
        channelId,
        messageId,
        raw: rawPayload,
      },
      receivedAt: input.receivedAt,
    }
  }
}

function parseBody(input: AdapterInput): Record<string, unknown> {
  if (input.raw && typeof input.raw === 'object') {
    return input.raw as Record<string, unknown>
  }

  if (!input.body) return {}

  try {
    const parsed = JSON.parse(input.body)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : { value: parsed }
  } catch {
    return { message: input.body }
  }
}

function extractMessageText(body: Record<string, unknown>): string {
  // Try common message fields
  for (const key of ['text', 'message', 'content', 'body']) {
    const value = body[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  // Try nested message object
  const message = body.message
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

function hashRequest(method: string, path: string, body: Record<string, unknown>): string {
  const content = JSON.stringify({ method, path, body })
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12)
}
