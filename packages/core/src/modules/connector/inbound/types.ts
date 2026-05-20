import type { ConnectorDefinition } from '../types'

export type InboundTransport = 'http' | 'websocket' | 'test' | string

export interface InboundEvent {
  id: string
  connectorId: string
  protocol: 'feishu' | 'wecom' | 'wechat-mp' | 'wechat-kf' | string
  transport: InboundTransport
  externalEventId: string
  channel: {
    id: string
    type?: string
  }
  sender: {
    id: string
    name?: string
    type: 'user' | 'bot'
  }
  message: {
    id: string
    type: 'text' | 'image' | 'file' | 'event' | string
    text?: string
    raw?: unknown
  }
  replyAddress: ReplyAddress
  receivedAt: number
}

export interface ReplyAddress {
  connectorId: string
  protocol: string
  channelId: string
  messageId?: string
  threadId?: string
  raw?: unknown
}

export interface OutboundMessage {
  type: 'text' | string
  text?: string
  raw?: unknown
}

export interface RespondResult {
  success: boolean
  result?: unknown
  error?: string
}

export interface ConnectorInboundConfig {
  connectorId: string
  protocol: string
  credentials: Record<string, string>
  inbound?: ConnectorDefinition['inbound']
  connector?: ConnectorDefinition
}

export interface AdapterInput {
  connectorId: string
  protocol: string
  transport: InboundTransport
  query: Record<string, string>
  headers: Record<string, string>
  body?: string
  raw?: unknown
  receivedAt: number
}

export interface ExternalInboundInput {
  connectorId: string
  protocol: string
  transport: InboundTransport
  raw: unknown
  headers?: Record<string, string>
  query?: Record<string, string>
  receivedAt?: number
}

export interface InboundAcceptResult {
  accepted: boolean
  status: number
  body?: string | Record<string, unknown>
  eventId?: string
  reason?: string
}

export interface PublishResult {
  eventId: string
  accepted: boolean
  reason?: 'duplicate' | 'queue_full' | 'closed'
}

export interface InboundInboxStats {
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  dead?: number
  maxSize?: number
}

export type Unsubscribe = () => void

export interface InboundInbox {
  publish(event: InboundEvent): Promise<PublishResult>
  subscribe(handler: (event: InboundEvent) => Promise<void>): Unsubscribe
  getStats(): InboundInboxStats
}

export interface ConnectorInboundRuntime {
  gateway: {
    acceptHttp(request: import('./gateway/http-request').InboundHttpRequest): Promise<InboundAcceptResult>
    acceptExternal(input: ExternalInboundInput): Promise<InboundAcceptResult>
  }
  inbox: InboundInbox
  responder: {
    respond(address: ReplyAddress, message: OutboundMessage): Promise<RespondResult>
  }
  startConsumer(service: { handle(event: InboundEvent): Promise<void> }): void
  stopConsumer(): void
}

export function normalizeTextMessage(message: string | OutboundMessage): OutboundMessage {
  if (typeof message === 'string') {
    return { type: 'text', text: message }
  }
  return message
}
