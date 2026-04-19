// ============================================================
// 幂等去重 - 使用 SQLite 替代 Redis（适合单实例部署）
// ============================================================

import { getDatabase } from '../native-loader'
import path from 'path'

export interface IdempotencyGuardOptions {
  dbPath?: string
  ttlMs?: number
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时

export class IdempotencyGuard {
  private db: any // Database.Database
  private ttlMs: number

  constructor(options?: IdempotencyGuardOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
    const dbPath = options?.dbPath ?? path.join(process.cwd(), '.connector-idempotency.db')
    const Database = getDatabase()
    // Use standard npm package signature: (filename, options)
    this.db = new Database(dbPath)

    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        connector_type TEXT NOT NULL,
        processed_at INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_processed_at
      ON processed_messages(processed_at)
    `)

    // 清理过期记录
    this.cleanup()
  }

  /**
   * 检查消息是否已处理
   * @returns true 表示重复消息，应跳过处理
   */
  async isDuplicate(messageId: string, connectorType?: string): Promise<boolean> {
    const row = this.db.prepare(
      'SELECT 1 FROM processed_messages WHERE message_id = ? LIMIT 1'
    ).get(messageId)

    if (!row) {
      // 标记为已处理
      this.db.prepare(
        'INSERT INTO processed_messages (message_id, connector_type, processed_at) VALUES (?, ?, ?)'
      ).run(messageId, connectorType ?? '', Date.now())
      return false
    }

    return true
  }

  /**
   * 批量检查并标记（适合批量导入场景）
   */
  async markProcessed(messageIds: string[], connectorType: string): Promise<string[]> {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO processed_messages (message_id, connector_type, processed_at) VALUES (?, ?, ?)'
    )

    const alreadyProcessed: string[] = []
    const now = Date.now()

    const insertMany = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        const existing = this.db.prepare(
          'SELECT 1 FROM processed_messages WHERE message_id = ? LIMIT 1'
        ).get(id)

        if (existing) {
          alreadyProcessed.push(id)
        } else {
          insert.run(id, connectorType, now)
        }
      }
    })

    insertMany(messageIds)
    return alreadyProcessed
  }

  /**
   * 清理过期记录
   */
  cleanup(): void {
    const cutoff = Date.now() - this.ttlMs
    this.db.prepare(
      'DELETE FROM processed_messages WHERE processed_at < ?'
    ).run(cutoff)
  }

  /**
   * 获取统计信息
   */
  getStats(): { total: number; oldest: number | null; newest: number | null } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        MIN(processed_at) as oldest,
        MAX(processed_at) as newest
      FROM processed_messages
    `).get() as { total: number; oldest: number | null; newest: number | null }

    return row
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close()
  }
}

// 默认实例
export const idempotencyGuard = new IdempotencyGuard()
