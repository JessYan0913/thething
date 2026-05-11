// ============================================================
// Audit Logger - 记录 Connector 操作审计日志
// ============================================================

export type AuditEventType =
  | 'tool_call'
  | 'token_refresh'
  | 'auth_failure'
  | 'circuit_breaker_trip'
  | 'retry'
  | 'inbound_message'
  | 'config_change'

export interface AuditLogEntry {
  id: string
  timestamp: number
  type: AuditEventType
  connector_id?: string
  tool_name?: string
  status: 'success' | 'failure' | 'warning'
  message: string
  metadata?: Record<string, unknown>
  duration_ms?: number
}

export interface AuditLoggerOptions {
  maxEntries?: number
  onLog?: (entry: AuditLogEntry) => void
  dbPath?: string
  enablePersistence?: boolean
}

export class AuditLogger {
  private entries: AuditLogEntry[] = []
  private maxEntries: number
  private onLog?: (entry: AuditLogEntry) => void
  private dbPath?: string
  private enablePersistence: boolean

  constructor(options?: AuditLoggerOptions) {
    this.maxEntries = options?.maxEntries ?? 1000
    this.onLog = options?.onLog
    this.dbPath = options?.dbPath
    this.enablePersistence = options?.enablePersistence ?? false
  }

  log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: Date.now(),
    }

    this.entries.push(fullEntry)

    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries)
    }

    this.onLog?.(fullEntry)

    return fullEntry
  }

  logToolCall(
    connectorId: string,
    toolName: string,
    status: 'success' | 'failure',
    message: string,
    durationMs?: number,
    metadata?: Record<string, unknown>
  ): AuditLogEntry {
    return this.log({
      type: 'tool_call',
      connector_id: connectorId,
      tool_name: toolName,
      status,
      message,
      duration_ms: durationMs,
      metadata,
    })
  }

  logTokenRefresh(
    connectorId: string,
    status: 'success' | 'failure',
    message: string,
    durationMs?: number
  ): AuditLogEntry {
    return this.log({
      type: 'token_refresh',
      connector_id: connectorId,
      status,
      message,
      duration_ms: durationMs,
    })
  }

  logCircuitBreakerTrip(
    connectorId: string,
    message: string
  ): AuditLogEntry {
    return this.log({
      type: 'circuit_breaker_trip',
      connector_id: connectorId,
      status: 'warning',
      message,
    })
  }

  logRetry(
    connectorId: string,
    toolName: string,
    attempt: number,
    message: string
  ): AuditLogEntry {
    return this.log({
      type: 'retry',
      connector_id: connectorId,
      tool_name: toolName,
      status: 'warning',
      message: 'Attempt ' + attempt + ': ' + message,
    })
  }

  logInboundMessage(
    connectorType: string,
    messageId: string,
    status: 'success' | 'failure',
    message: string
  ): AuditLogEntry {
    return this.log({
      type: 'inbound_message',
      connector_id: connectorType,
      status,
      message,
      metadata: { message_id: messageId },
    })
  }

  getEntries(filter?: {
    type?: AuditEventType
    connector_id?: string
    status?: 'success' | 'failure' | 'warning'
    limit?: number
  }): AuditLogEntry[] {
    let result = [...this.entries]

    if (filter?.type) {
      result = result.filter(e => e.type === filter.type)
    }
    if (filter?.connector_id) {
      result = result.filter(e => e.connector_id === filter.connector_id)
    }
    if (filter?.status) {
      result = result.filter(e => e.status === filter.status)
    }

    result.sort((a, b) => b.timestamp - a.timestamp)

    if (filter?.limit) {
      result = result.slice(0, filter.limit)
    }

    return result
  }

  clear(): void {
    this.entries = []
  }

  private generateId(): string {
    return 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)
  }
}
