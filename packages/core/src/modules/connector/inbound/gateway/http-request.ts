export interface InboundHttpRequest {
  method: string
  path: string
  params?: Record<string, string>
  query: Record<string, string>
  headers: Record<string, string>
  body: string
  connectorId?: string
  protocol?: string
  transport?: string
}

