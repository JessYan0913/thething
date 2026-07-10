import path from 'path'
import { logger } from '../../../../primitives/logger'
import { getDatabase } from '../../../../services/datastore/sqlite/native-loader'
import type { SqliteDatabase } from '../../../../primitives/datastore/types'
import type { InboundEvent, InboundInbox, InboundInboxStats, PublishResult, Unsubscribe } from '../types'

export interface SQLiteInboundInboxOptions {
  dbPath: string
  maxAttempts?: number
  visibilityTimeoutMs?: number
  heartbeatIntervalMs?: number
  retryBaseDelayMs?: number
  pollIntervalMs?: number
}

/**
 * SQLite 可靠队列实现
 * 支持幂等、重试、死信队列、可见性超时
 */
export class SQLiteInboundInbox implements InboundInbox {
  private db: SqliteDatabase
  private handlers = new Set<(event: InboundEvent) => Promise<void>>()
  private readonly maxAttempts: number
  private readonly visibilityTimeoutMs: number
  private readonly heartbeatIntervalMs: number
  private readonly retryBaseDelayMs: number
  private readonly pollIntervalMs: number
  private pollTimer?: ReturnType<typeof setInterval>
  private dispatching = false

  constructor(options: SQLiteInboundInboxOptions) {
    this.maxAttempts = options.maxAttempts ?? 5
    this.visibilityTimeoutMs = options.visibilityTimeoutMs ?? 60_000
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(1_000, Math.floor(this.visibilityTimeoutMs / 3))
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000
    const Database = getDatabase()
    this.db = new Database(options.dbPath)
    this.initialize()
  }

  static fromDataDir(dataDir: string): SQLiteInboundInbox {
    return new SQLiteInboundInbox({ dbPath: path.join(dataDir, 'connector-inbound-inbox.db') })
  }

  async publish(event: InboundEvent): Promise<PublishResult> {
    const now = Date.now()
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO connector_inbox_events (
        id,
        connector_id,
        protocol,
        external_event_id,
        status,
        payload,
        attempts,
        max_attempts,
        next_attempt_at,
        queued_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?)
    `).run(
      event.id,
      event.connectorId,
      event.protocol,
      event.externalEventId,
      JSON.stringify(event),
      this.maxAttempts,
      now,
      now,
      now,
    ) as unknown as { changes?: number }

    if (result.changes === 0) {
      return { eventId: event.id, accepted: false, reason: 'duplicate' }
    }

    this.dispatchPending()
    return { eventId: event.id, accepted: true }
  }

  subscribe(handler: (event: InboundEvent) => Promise<void>): Unsubscribe {
    this.handlers.add(handler)
    this.startPolling()
    return () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0) {
        this.stopPolling()
      }
    }
  }

  getStats(): InboundInboxStats {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM connector_inbox_events
      GROUP BY status
    `).all() as Array<{ status: string; count: number }>

    const stats: InboundInboxStats = {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead: 0,
    }

    for (const row of rows) {
      const status = row.status as keyof InboundInboxStats
      if (status in stats) {
        stats[status] = row.count
      }
    }

    stats.total = stats.pending + stats.processing + stats.completed + stats.failed + (stats.dead ?? 0)

    return stats
  }

  close(): void {
    this.stopPolling()
    this.db.close()
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connector_inbox_events (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        protocol TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_attempt_at INTEGER NOT NULL,
        locked_until INTEGER,
        error TEXT,
        queued_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_inbox_status_next_attempt
      ON connector_inbox_events (status, next_attempt_at);

      CREATE INDEX IF NOT EXISTS idx_inbox_external_event_id
      ON connector_inbox_events (external_event_id);
    `)
  }

  private async dispatchPending(): Promise<void> {
    if (this.dispatching || this.handlers.size === 0) return
    this.dispatching = true

    try {
      const now = Date.now()
      const lockedUntil = now + this.visibilityTimeoutMs

      // Find and lock a pending event
      const event = this.db.prepare(`
        UPDATE connector_inbox_events
        SET status = 'processing',
            locked_until = ?,
            attempts = attempts + 1,
            updated_at = ?
        WHERE id = (
          SELECT id FROM connector_inbox_events
          WHERE status = 'pending'
            AND next_attempt_at <= ?
          ORDER BY next_attempt_at ASC
          LIMIT 1
        )
        RETURNING *
      `).get(lockedUntil, now, now) as Record<string, unknown> | undefined

      if (!event) {
        return
      }

      const payload = JSON.parse(event.payload as string) as InboundEvent

      // Dispatch to all handlers
      for (const handler of this.handlers) {
        try {
          await handler(payload)
          this.markCompleted(event.id as string)
        } catch (error) {
          const attempts = event.attempts as number
          const maxAttempts = event.max_attempts as number
          const errorMessage = error instanceof Error ? error.message : String(error)

          if (attempts >= maxAttempts) {
            this.markDead(event.id as string, errorMessage)
          } else {
            this.markPending(event.id as string, attempts, errorMessage)
          }
        }
      }
    } finally {
      this.dispatching = false
    }
  }

  private markCompleted(eventId: string): void {
    this.db.prepare(`
      UPDATE connector_inbox_events
      SET status = 'completed',
          locked_until = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(Date.now(), eventId)
  }

  private markDead(eventId: string, error: string): void {
    this.db.prepare(`
      UPDATE connector_inbox_events
      SET status = 'dead',
          locked_until = NULL,
          error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(error, Date.now(), eventId)
  }

  private markPending(eventId: string, attempts: number, error: string): void {
    const status = attempts >= this.maxAttempts ? 'dead' : 'pending'
    const now = Date.now()
    const nextAttemptAt = status === 'pending'
      ? now + this.retryDelay(attempts)
      : now

    this.db.prepare(`
      UPDATE connector_inbox_events
      SET status = ?,
          attempts = ?,
          next_attempt_at = ?,
          locked_until = NULL,
          error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(status, attempts, nextAttemptAt, error, now, eventId)
  }

  private recoverExpiredLocks(): void {
    const now = Date.now()
    this.db.prepare(`
      UPDATE connector_inbox_events
      SET status = 'pending',
          locked_until = NULL,
          next_attempt_at = ?,
          updated_at = ?
      WHERE status = 'processing'
        AND locked_until IS NOT NULL
        AND locked_until < ?
    `).run(now, now, now)
  }

  private retryDelay(attempts: number): number {
    const capped = Math.min(attempts, 6)
    return this.retryBaseDelayMs * Math.pow(2, capped - 1)
  }

  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      this.dispatchPending()
      this.recoverExpiredLocks()
    }, this.pollIntervalMs)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }
}
