// ============================================================
// Audit Logger - 记录 Connector 操作审计日志
// ============================================================
// 内存环形缓冲（快速查询） + 可选 SQLite 持久化（审计留痕）

import { logger } from '../../primitives/logger'
import { getDatabase } from '../../services/datastore/sqlite/native-loader'
import type { SqliteDatabase } from '../../primitives/datastore/types'

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
  private db: SqliteDatabase | null = null

  constructor(options?: AuditLoggerOptions) {
    this.maxEntries = options?.maxEntries ?? 1000
    this.onLog = options?.onLog

    if (options?.enablePersistence && options.dbPath) {
      try {
        const Database = getDatabase()
        this.db = new Database(options.dbPath)
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS connector_audit_log (
            id TEXT PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            type TEXT NOT NULL,
            connector_id TEXT,
            tool_name TEXT,
            status TEXT NOT NULL,
            message TEXT NOT NULL,
            metadata TEXT,
            duration_ms INTEGER
          );
          CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON connector_audit_log (timestamp);
          CREATE INDEX IF NOT EXISTS idx_audit_connector ON connector_audit_log (connector_id, timestamp);
        `)
      } catch (error) {
        logger.warn('AuditLogger', 'Failed to initialize SQLite persistence; falling back to memory only:', error)
        this.db = null
      }
    }
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

    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO connector_audit_log (id, timestamp, type, connector_id, tool_name, status, message, metadata, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fullEntry.id,
          fullEntry.timestamp,
          fullEntry.type,
          fullEntry.connector_id ?? null,
          fullEntry.tool_name ?? null,
          fullEntry.status,
          fullEntry.message,
          fullEntry.metadata ? JSON.stringify(fullEntry.metadata) : null,
          fullEntry.duration_ms ?? null,
        )
      } catch (error) {
        logger.warn('AuditLogger', 'Failed to persist audit entry:', error)
      }
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
    message: string
  ): AuditLogEntry {
    return this.log({
      type: 'token_refresh',
      connector_id: connectorId,
      status,
      message,
    })
  }

  logAuthFailure(
    connectorId: string,
    message: string,
    metadata?: Record<string, unknown>
  ): AuditLogEntry {
    return this.log({
      type: 'auth_failure',
      connector_id: connectorId,
      status: 'failure',
      message,
      metadata,
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
      message,
      metadata: { attempt },
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

  close(): void {
    try {
      this.db?.close()
    } catch { /* already closed */ }
    this.db = null
  }

  private generateId(): string {
    return 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)
  }
}
