import path from 'path'
import { getDatabase } from '../../../../foundation/datastore/sqlite/native-loader'
import type { SqliteDatabase } from '../../../../foundation/datastore/types'
import type { InboundEvent, InboundInbox, InboundInboxStats, PublishResult, Unsubscribe } from '../types'

export interface SQLiteInboundInboxOptions {
  dbPath: string
  maxAttempts?: number
  visibilityTimeoutMs?: number
  heartbeatIntervalMs?: number
  retryBaseDelayMs?: number
  pollIntervalMs?: number
}

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
    this.dispatchPending()
    return () => {
      this.handlers.delete(handler)
    }
  }

  getStats(): InboundInboxStats {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS count
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
      const count = Number(row.count)
      stats.total += count
      if (row.status === 'pending') stats.pending = count
      if (row.status === 'processing') stats.processing = count
      if (row.status === 'completed') stats.completed = count
      if (row.status === 'failed') stats.failed = count
      if (row.status === 'dead') stats.dead = count
    }

    return stats
  }

  close(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
    this.db.close()
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connector_inbox_events (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        protocol TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
        payload TEXT NOT NULL,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        queued_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(connector_id, protocol, external_event_id)
      );
    `)

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_inbox_events_unique_external
        ON connector_inbox_events(connector_id, protocol, external_event_id);

      CREATE INDEX IF NOT EXISTS idx_connector_inbox_events_status
        ON connector_inbox_events(status, next_attempt_at, queued_at);

      CREATE INDEX IF NOT EXISTS idx_connector_inbox_events_external
        ON connector_inbox_events(connector_id, protocol, external_event_id);
    `)
  }

  private dispatch(event: InboundEvent): void {
    Promise.resolve()
      .then(() => this.processEvent(event))
      .catch((error) => {
        console.error('[SQLiteInboundInbox] Processing failed:', event.id, error)
      })
  }

  private async processEvent(event: InboundEvent): Promise<void> {
    const stopHeartbeat = this.startHeartbeat(event.id)
    try {
      for (const handler of this.handlers) {
        await handler(event)
      }
      this.markCompleted(event.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.markFailed(event.id, message)
      console.error('[SQLiteInboundInbox] Processing failed:', event.id, error)
    } finally {
      stopHeartbeat()
      this.dispatchPending()
    }
  }

  private startHeartbeat(eventId: string): () => void {
    let stopped = false
    const timer = setInterval(() => {
      if (stopped) return
      try {
        this.renewLock(eventId)
      } catch (error) {
        console.error('[SQLiteInboundInbox] Failed to renew event lock:', eventId, error)
      }
    }, this.heartbeatIntervalMs)

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  private dispatchPending(): void {
    if (this.dispatching) return
    this.dispatching = true

    try {
      if (this.handlers.size === 0) return

      this.recoverExpiredLocks()

      const rows = this.db.prepare(`
        SELECT id, payload
        FROM connector_inbox_events
        WHERE status = 'pending'
          AND next_attempt_at <= ?
        ORDER BY queued_at ASC
      `).all(Date.now()) as Array<{ id: string; payload: string }>

      for (const row of rows) {
        try {
          if (this.claim(row.id)) {
            this.dispatch(JSON.parse(row.payload) as InboundEvent)
          }
        } catch (error) {
          console.error('[SQLiteInboundInbox] Failed to dispatch pending event:', error)
        }
      }
    } finally {
      this.dispatching = false
    }
  }

  private claim(eventId: string): boolean {
    const now = Date.now()
    const result = this.db.prepare(`
      UPDATE connector_inbox_events
      SET status = 'processing',
          locked_until = ?,
          error = NULL,
          updated_at = ?
      WHERE id = ?
        AND status = 'pending'
        AND next_attempt_at <= ?
    `).run(now + this.visibilityTimeoutMs, now, eventId, now) as unknown as { changes?: number }

    return (result.changes ?? 0) > 0
  }

  private markCompleted(eventId: string): void {
    this.db.prepare(`
      UPDATE connector_inbox_events
      SET status = 'completed',
          error = NULL,
          locked_until = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(Date.now(), eventId)
  }

  private renewLock(eventId: string): void {
    const now = Date.now()
    this.db.prepare(`
      UPDATE connector_inbox_events
      SET locked_until = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'processing'
    `).run(now + this.visibilityTimeoutMs, now, eventId)
  }

  private markFailed(eventId: string, error: string): void {
    const row = this.db.prepare(`
      SELECT attempts, max_attempts
      FROM connector_inbox_events
      WHERE id = ?
    `).get(eventId) as { attempts: number; max_attempts: number } | undefined

    const attempts = (row?.attempts ?? 0) + 1
    const maxAttempts = row?.max_attempts ?? this.maxAttempts
    const status = attempts >= maxAttempts ? 'dead' : 'pending'
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
    }, this.pollIntervalMs)
  }
}
