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
  batchSize?: number
  completedTtlMs?: number
}

/**
 * SQLite 可靠队列实现
 * 支持幂等、重试、死信队列、可见性超时、心跳续锁、批量派发
 */
export class SQLiteInboundInbox implements InboundInbox {
  private db: SqliteDatabase
  private handlers = new Set<(event: InboundEvent) => Promise<void>>()
  private readonly maxAttempts: number
  private readonly visibilityTimeoutMs: number
  private readonly heartbeatIntervalMs: number
  private readonly retryBaseDelayMs: number
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private readonly completedTtlMs: number
  private pollTimer?: ReturnType<typeof setInterval>
  private cleanupTimer?: ReturnType<typeof setInterval>
  private dispatching = false

  constructor(options: SQLiteInboundInboxOptions) {
    this.maxAttempts = options.maxAttempts ?? 5
    this.visibilityTimeoutMs = options.visibilityTimeoutMs ?? 60_000
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(1_000, Math.floor(this.visibilityTimeoutMs / 3))
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000
    this.batchSize = options.batchSize ?? 10
    this.completedTtlMs = options.completedTtlMs ?? 7 * 24 * 60 * 60 * 1000
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
    `)

    // 去重以业务身份 (connector_id, external_event_id) 为准，与传输通道无关：
    // 同一条飞书消息从 HTTP 和 WebSocket 同时进来只处理一次。
    // 建唯一索引前先清理历史重复行（保留最早一条）。
    try {
      this.db.exec(`
        DELETE FROM connector_inbox_events
        WHERE rowid NOT IN (
          SELECT MIN(rowid) FROM connector_inbox_events
          GROUP BY connector_id, external_event_id
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_dedup
        ON connector_inbox_events (connector_id, external_event_id);
      `)
    } catch (error) {
      logger.error('SQLiteInboundInbox', 'Failed to create dedup index:', error)
    }

    this.cleanupExpiredRecords()
  }

  private async dispatchPending(): Promise<void> {
    if (this.dispatching || this.handlers.size === 0) return
    this.dispatching = true

    try {
      // 连续派发：处理完一批立即取下一批，直到队列为空
      while (this.handlers.size > 0) {
        const batch = this.claimBatch()
        if (batch.length === 0) break

        for (const event of batch) {
          await this.processOne(event)
        }
      }
    } finally {
      this.dispatching = false
    }
  }

  private claimBatch(): Array<Record<string, unknown>> {
    const now = Date.now()
    const lockedUntil = now + this.visibilityTimeoutMs

    return this.db.prepare(`
      UPDATE connector_inbox_events
      SET status = 'processing',
          locked_until = ?,
          attempts = attempts + 1,
          updated_at = ?
      WHERE id IN (
        SELECT id FROM connector_inbox_events
        WHERE status = 'pending'
          AND next_attempt_at <= ?
        ORDER BY next_attempt_at ASC
        LIMIT ?
      )
      RETURNING *
    `).all(lockedUntil, now, now, this.batchSize) as Array<Record<string, unknown>>
  }

  private async processOne(event: Record<string, unknown>): Promise<void> {
    const eventId = event.id as string
    const payload = JSON.parse(event.payload as string) as InboundEvent

    // 心跳续锁：Agent 处理可能是分钟级，处理期间定时延长锁，
    // 防止可见性超时导致消息被重复派发；worker 崩溃后锁自然过期快速恢复。
    const heartbeat = setInterval(() => {
      try {
        this.db.prepare(`
          UPDATE connector_inbox_events
          SET locked_until = ?, updated_at = ?
          WHERE id = ? AND status = 'processing'
        `).run(Date.now() + this.visibilityTimeoutMs, Date.now(), eventId)
      } catch (error) {
        logger.warn('SQLiteInboundInbox', 'Heartbeat renewal failed:', error)
      }
    }, this.heartbeatIntervalMs)

    try {
      for (const handler of this.handlers) {
        await handler(payload)
      }
      this.markCompleted(eventId)
    } catch (error) {
      const attempts = event.attempts as number
      const maxAttempts = event.max_attempts as number
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (attempts >= maxAttempts) {
        this.markDead(eventId, errorMessage)
      } else {
        this.markPending(eventId, attempts, errorMessage)
      }
    } finally {
      clearInterval(heartbeat)
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

  private cleanupExpiredRecords(): void {
    try {
      const cutoff = Date.now() - this.completedTtlMs
      const result = this.db.prepare(`
        DELETE FROM connector_inbox_events
        WHERE status IN ('completed', 'dead')
          AND updated_at < ?
      `).run(cutoff) as unknown as { changes?: number }
      if (result.changes) {
        logger.debug('SQLiteInboundInbox', `Cleaned up ${result.changes} expired records`)
      }
    } catch (error) {
      logger.warn('SQLiteInboundInbox', 'Cleanup failed:', error)
    }
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
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredRecords()
    }, 60 * 60 * 1000)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }
}
