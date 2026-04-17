// ============================================================
// 数据库连接池管理 - 支持 SQLite/PostgreSQL/MySQL
// PostgreSQL 和 MySQL 为可选依赖，需要时安装: npm install pg 或 npm install mysql2
// ============================================================

import * as Database from 'better-sqlite3'

export type DatabaseType = 'sqlite' | 'postgresql' | 'mysql'

export interface DatabaseConnectionConfig {
  type: DatabaseType
  connection_id: string

  // SQLite 配置
  path?: string

  // PostgreSQL 配置
  postgresql?: {
    host: string
    port: number
    database: string
    user: string
    password: string
    ssl?: boolean | { rejectUnauthorized: boolean }
    max_pool_size?: number
  }

  // MySQL 配置
  mysql?: {
    host: string
    port: number
    database: string
    user: string
    password: string
    ssl?: boolean | { rejectUnauthorized: boolean }
    max_pool_size?: number
  }
}

export interface DatabasePool {
  type: DatabaseType
  connectionId: string
  isConnected: boolean
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
  close: () => Promise<void>
  connect?: (config: DatabaseConnectionConfig) => Promise<void>
}

/**
 * SQLite 连接池
 */
class SQLitePool implements DatabasePool {
  type: DatabaseType = 'sqlite'
  connectionId: string
  isConnected: boolean = false
  private db: Database.Database | null = null

  constructor(config: DatabaseConnectionConfig) {
    this.connectionId = config.connection_id
    if (config.path) {
      const dbInstance = new (Database as any).Database(config.path, { readonly: true })
      this.db = dbInstance
      dbInstance.pragma('journal_mode = WAL')
      this.isConnected = true
    }
  }

  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    if (!this.db) {
      throw new Error('SQLite database not initialized')
    }

    const stmt = this.db.prepare(sql)
    const rows = params ? stmt.all(...params) as Record<string, unknown>[] : stmt.all() as Record<string, unknown>[]

    return { rows, rowCount: rows.length }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
      this.isConnected = false
    }
  }
}

/**
 * PostgreSQL 连接池（使用 pg 库）
 * 注：需要安装 pg 和 pg-pool
 */
class PostgreSQLPool implements DatabasePool {
  type: DatabaseType = 'postgresql'
  connectionId: string
  isConnected: boolean = false
  private pool: unknown = null

  constructor(config: DatabaseConnectionConfig) {
    this.connectionId = config.connection_id
    // PostgreSQL 连接需要动态导入 pg 库
    // 实际部署时确保 pg 已安装
    console.log('[PostgreSQLPool] Configuration ready:', config.postgresql?.host)
  }

  async connect(config: DatabaseConnectionConfig): Promise<void> {
    if (this.isConnected) return

    try {
      // 动态导入 pg 库（避免未安装时报错）
      // @ts-ignore - pg 为可选依赖，仅在需要 PostgreSQL 支持时安装
      const pgModule = await import('pg')
      const { Pool } = pgModule

      const pgConfig = config.postgresql!
      this.pool = new Pool({
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        user: pgConfig.user,
        password: pgConfig.password,
        ssl: pgConfig.ssl,
        max: pgConfig.max_pool_size || 10,
      })

      this.isConnected = true
      console.log('[PostgreSQLPool] Connected:', this.connectionId)
    } catch (error) {
      // pg 库未安装
      console.error('[PostgreSQLPool] pg library not installed or connection failed:', error)
      throw new Error('PostgreSQL support requires pg library. Install: npm install pg')
    }
  }

  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized')
    }

    const pool = this.pool as { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }> }
    const result = await pool.query(sql, params)

    return {
      rows: result.rows,
      rowCount: result.rowCount || result.rows.length,
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      const pool = this.pool as { end: () => Promise<void> }
      await pool.end()
      this.pool = null
      this.isConnected = false
    }
  }
}

/**
 * MySQL 连接池（使用 mysql2 库）
 * 注：需要安装 mysql2
 */
class MySQLPool implements DatabasePool {
  type: DatabaseType = 'mysql'
  connectionId: string
  isConnected: boolean = false
  private pool: unknown = null

  constructor(config: DatabaseConnectionConfig) {
    this.connectionId = config.connection_id
    console.log('[MySQLPool] Configuration ready:', config.mysql?.host)
  }

  async connect(config: DatabaseConnectionConfig): Promise<void> {
    if (this.isConnected) return

    try {
      // 动态导入 mysql2 库
      // @ts-ignore - mysql2 为可选依赖，仅在需要 MySQL 支持时安装
      const mysql = await import('mysql2/promise')

      const mysqlConfig = config.mysql!
      this.pool = mysql.createPool({
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        database: mysqlConfig.database,
        user: mysqlConfig.user,
        password: mysqlConfig.password,
        ssl: mysqlConfig.ssl,
        connectionLimit: mysqlConfig.max_pool_size || 10,
      })

      this.isConnected = true
      console.log('[MySQLPool] Connected:', this.connectionId)
    } catch (error) {
      console.error('[MySQLPool] mysql2 library not installed or connection failed:', error)
      throw new Error('MySQL support requires mysql2 library. Install: npm install mysql2')
    }
  }

  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    if (!this.pool) {
      throw new Error('MySQL pool not initialized')
    }

    const pool = this.pool as { execute: (sql: string, params?: unknown[]) => Promise<[Record<string, unknown>[], unknown]> }
    const [rows] = await pool.execute(sql, params)

    return {
      rows: rows as Record<string, unknown>[],
      rowCount: (rows as Record<string, unknown>[]).length,
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      const pool = this.pool as { end: () => Promise<void> }
      await pool.end()
      this.pool = null
      this.isConnected = false
    }
  }
}

/**
 * 数据库连接池管理器
 */
export class DatabasePoolManager {
  private pools = new Map<string, DatabasePool>()
  private configs = new Map<string, DatabaseConnectionConfig>()

  /**
   * 注册数据库连接配置
   */
  registerConfig(config: DatabaseConnectionConfig): void {
    this.configs.set(config.connection_id, config)
    console.log('[DatabasePoolManager] Config registered:', config.connection_id, config.type)
  }

  /**
   * 获取或创建连接池
   */
  async getPool(connectionId: string): Promise<DatabasePool> {
    // 已存在连接池
    if (this.pools.has(connectionId)) {
      return this.pools.get(connectionId)!
    }

    // 获取配置
    const config = this.configs.get(connectionId)
    if (!config) {
      throw new Error(`Database connection config not found: ${connectionId}`)
    }

    // 创建连接池
    let pool: DatabasePool

    switch (config.type) {
      case 'sqlite':
        pool = new SQLitePool(config)
        break

      case 'postgresql':
        pool = new PostgreSQLPool(config)
        if (pool.connect) {
          await pool.connect(config)
        }
        break

      case 'mysql':
        pool = new MySQLPool(config)
        if (pool.connect) {
          await pool.connect(config)
        }
        break

      default:
        throw new Error(`Unsupported database type: ${config.type}`)
    }

    this.pools.set(connectionId, pool)
    return pool
  }

  /**
   * 执行查询
   */
  async query(
    connectionId: string,
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const pool = await this.getPool(connectionId)
    return pool.query(sql, params)
  }

  /**
   * 关闭指定连接池
   */
  async close(connectionId: string): Promise<void> {
    const pool = this.pools.get(connectionId)
    if (pool) {
      await pool.close()
      this.pools.delete(connectionId)
    }
  }

  /**
   * 关闭所有连接池
   */
  async closeAll(): Promise<void> {
    const poolEntries = Array.from(this.pools.entries())
    for (const [id, pool] of poolEntries) {
      await pool.close()
      console.log('[DatabasePoolManager] Pool closed:', id)
    }
    this.pools.clear()
  }

  /**
   * 获取连接池状态
   */
  getStats(): Array<{
    connectionId: string
    type: DatabaseType
    isConnected: boolean
  }> {
    return Array.from(this.pools.values()).map(pool => ({
      connectionId: pool.connectionId,
      type: pool.type,
      isConnected: pool.isConnected,
    }))
  }

  /**
   * 检查连接池是否存在
   */
  has(connectionId: string): boolean {
    return this.pools.has(connectionId) || this.configs.has(connectionId)
  }
}

// 单例导出
export const databasePoolManager = new DatabasePoolManager()