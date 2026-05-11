// ============================================================
// 幂等去重 - 使用 SQLite 替代 Redis（适合单实例部署）
// ============================================================

import { getDatabase } from '../../foundation/datastore/sqlite/native-loader'
import path from 'path'
import os from 'os'
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../config/defaults'

// 默认数据目录: ~/${DEFAULT_PROJECT_CONFIG_DIR_NAME}/data（硬编码默认值，不读取环境变量）
const DEFAULT_DATA_DIR = path.join(os.homedir(), DEFAULT_PROJECT_CONFIG_DIR_NAME, 'data')

export interface IdempotencyGuardOptions {
  /** 数据库路径，默认为 ~/${DEFAULT_PROJECT_CONFIG_DIR_NAME}/data/.connector-idempotency.db */
  dbPath?: string
  ttlMs?: number
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时

export class IdempotencyGuard {
  private db: any // Database.Database
  private ttlMs: number

  constructor(options?: IdempotencyGuardOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
    // 默认使用 dataDir，而非 cwd
    const defaultDbPath = path.join(DEFAULT_DATA_DIR, '.connector-idempotency.db')
    const dbPath = options?.dbPath ?? defaultDbPath
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

// ============================================================
// 单例管理（强制显式配置，避免竞态）
// ============================================================

let idempotencyGuardInstance: IdempotencyGuard | null = null
let configuredOptions: IdempotencyGuardOptions | undefined = undefined
let initializationPromise: Promise<IdempotencyGuard> | null = null

/**
 * 配置 IdempotencyGuard（必须在首次使用前调用）
 *
 * 重要：必须在任何可能调用 getIdempotencyGuard 的代码之前调用此函数。
 * initConnectorGateway() 会自动调用此函数。
 *
 * @throws 如果已初始化则抛错（防止配置冲突）
 */
export function configureIdempotencyGuard(options?: IdempotencyGuardOptions): void {
  if (idempotencyGuardInstance) {
    throw new Error(
      '[IdempotencyGuard] Already initialized.\n' +
      'configureIdempotencyGuard() must be called BEFORE first use.\n' +
      'Current initialization order may be incorrect.'
    )
  }
  configuredOptions = options
}

/**
 * 获取 IdempotencyGuard 单例（异步版本）
 *
 * 使用异步版本确保正确的初始化顺序。
 * 如果 configureIdempotencyGuard 未被调用，使用默认配置。
 */
export async function getIdempotencyGuard(): Promise<IdempotencyGuard> {
  // 已初始化：直接返回
  if (idempotencyGuardInstance) {
    return idempotencyGuardInstance
  }

  // 正在初始化：等待完成
  if (initializationPromise) {
    return initializationPromise
  }

  // 开始初始化
  initializationPromise = (async () => {
    const instance = new IdempotencyGuard(configuredOptions)
    idempotencyGuardInstance = instance
    return instance
  })()

  return initializationPromise
}

/**
 * 获取 IdempotencyGuard 单例（同步版本）
 *
 * 仅在已预初始化的情况下可用。
 *
 * @throws 如果未预初始化则抛错
 */
export function getIdempotencyGuardSync(): IdempotencyGuard {
  if (!idempotencyGuardInstance) {
    throw new Error(
      '[IdempotencyGuard] Not initialized.\n' +
      'Call configureIdempotencyGuard() before synchronous use, ' +
      'or use async getIdempotencyGuard().\n' +
      'initConnectorGateway() should be called first.'
    )
  }
  return idempotencyGuardInstance
}

/**
 * 重置单例（仅用于测试）
 */
export function resetIdempotencyGuard(): void {
  if (idempotencyGuardInstance) {
    idempotencyGuardInstance.close()
  }
  idempotencyGuardInstance = null
  configuredOptions = undefined
  initializationPromise = null
}
