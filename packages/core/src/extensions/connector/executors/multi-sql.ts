// ============================================================
// 多数据库 SQL Executor - 支持 SQLite/PostgreSQL/MySQL
// ============================================================

import type { SqlExecutorConfig, ExecutorResult } from '../types'
import { DatabasePoolManager, databasePoolManager, type DatabaseConnectionConfig } from './database-pool'

export interface MultiSqlExecutorConfig {
  poolManager?: DatabasePoolManager
  getConnectionConfig?: (connectionId: string) => Promise<DatabaseConnectionConfig | null>
}

/**
 * 多数据库 SQL 执行器
 * 扩展原有 SqlExecutor，支持 PostgreSQL 和 MySQL
 */
export class MultiSqlExecutor {
  private poolManager: DatabasePoolManager
  private getConnectionConfig: (connectionId: string) => Promise<DatabaseConnectionConfig | null>

  constructor(config?: MultiSqlExecutorConfig) {
    this.poolManager = config?.poolManager || databasePoolManager
    this.getConnectionConfig = config?.getConnectionConfig || this.defaultGetConnectionConfig
  }

  /**
   * 执行 SQL 查询
   */
  async execute(
    config: SqlExecutorConfig,
    input: Record<string, unknown>
  ): Promise<ExecutorResult> {
    const startTime = Date.now()

    try {
      // 1. 安全检查：强制只读
      if (!config.allow_write) {
        this.assertReadOnly(config.query_template)
      }

      // 2. 获取连接配置
      const connectionConfig = await this.getConnectionConfig(config.connection_id)
      if (!connectionConfig) {
        throw new Error(`Database connection config not found: ${config.connection_id}`)
      }

      // 3. 注册配置到连接池管理器
      this.poolManager.registerConfig(connectionConfig)

      // 4. 参数绑定
      const { sql, params } = this.bindParameters(config.query_template, input, connectionConfig.type)

      // 5. 执行查询
      const result = await this.poolManager.query(config.connection_id, sql, params)

      // 6. 限制返回行数
      const maxRows = config.max_rows ?? 100
      const truncated = result.rows.length > maxRows
      const resultRows = truncated ? result.rows.slice(0, maxRows) : result.rows

      return {
        success: true,
        data: {
          rows: resultRows,
          row_count: resultRows.length,
          total_count: result.rows.length,
          truncated,
        },
        metadata: {
          duration_ms: Date.now() - startTime,
          connection_id: config.connection_id,
          db_type: connectionConfig.type,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { duration_ms: Date.now() - startTime },
      }
    }
  }

  /**
   * 默认获取连接配置的方式
   * 从环境变量或凭证存储读取
   */
  private async defaultGetConnectionConfig(connectionId: string): Promise<DatabaseConnectionConfig | null> {
    // 尝试从环境变量读取
    const envKey = `DB_${connectionId.toUpperCase().replace(/-/g, '_')}`

    // SQLite: 简单路径配置
    const sqlitePath = process.env[`${envKey}_PATH`]
    if (sqlitePath) {
      return {
        type: 'sqlite',
        connection_id: connectionId,
        path: sqlitePath,
      }
    }

    // PostgreSQL 配置
    const pgHost = process.env[`${envKey}_HOST`]
    if (pgHost) {
      return {
        type: 'postgresql',
        connection_id: connectionId,
        postgresql: {
          host: pgHost,
          port: parseInt(process.env[`${envKey}_PORT`] || '5432'),
          database: process.env[`${envKey}_DATABASE`] || '',
          user: process.env[`${envKey}_USER`] || '',
          password: process.env[`${envKey}_PASSWORD`] || '',
          ssl: process.env[`${envKey}_SSL`] === 'true',
          max_pool_size: parseInt(process.env[`${envKey}_POOL_SIZE`] || '10'),
        },
      }
    }

    // MySQL 配置
    const mysqlHost = process.env[`${envKey}_MYSQL_HOST`]
    if (mysqlHost) {
      return {
        type: 'mysql',
        connection_id: connectionId,
        mysql: {
          host: mysqlHost,
          port: parseInt(process.env[`${envKey}_MYSQL_PORT`] || '3306'),
          database: process.env[`${envKey}_MYSQL_DATABASE`] || '',
          user: process.env[`${envKey}_MYSQL_USER`] || '',
          password: process.env[`${envKey}_MYSQL_PASSWORD`] || '',
          ssl: process.env[`${envKey}_MYSQL_SSL`] === 'true',
          max_pool_size: parseInt(process.env[`${envKey}_MYSQL_POOL_SIZE`] || '10'),
        },
      }
    }

    // 尝试从 JSON 配置读取
    const jsonConfig = process.env[`${envKey}_CONFIG`]
    if (jsonConfig) {
      try {
        return JSON.parse(jsonConfig) as DatabaseConnectionConfig
      } catch {
        // 忽略解析错误
      }
    }

    return null
  }

  /**
   * 强制只读检查
   */
  private assertReadOnly(sql: string): void {
    const normalized = sql.trim().toUpperCase()
    const writeKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'REPLACE', 'MERGE']

    for (const kw of writeKeywords) {
      // 使用正则检查关键字，避免误判（如 SELECT ... FROM update_log）
      if (new RegExp('\\b' + kw + '\\b').test(normalized)) {
        throw new Error(`SQL_WRITE_NOT_ALLOWED: 检测到写操作关键字 ${kw}`)
      }
    }
  }

  /**
   * 参数绑定
   * 根据数据库类型使用不同的参数占位符
   */
  private bindParameters(
    template: string,
    input: Record<string, unknown>,
    dbType: string
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = []

    // 不同数据库的参数占位符格式
    // SQLite/PostgreSQL: $1, $2, $3
    // MySQL: ?, ?, ?
    // 通用模板格式: :param_name
    const placeholder = dbType === 'mysql' ? '?' : '$'

    const sql = template.replace(/:(\w+)/g, (_, name: string) => {
      if (!(name in input)) {
        // 如果参数不存在，使用 NULL
        console.warn(`[MultiSqlExecutor] Missing parameter: ${name}, using NULL`)
        params.push(null)
      } else {
        params.push(input[name])
      }
      return placeholder + params.length
    })

    return { sql, params }
  }

  /**
   * 关闭所有连接池
   */
  async closeAll(): Promise<void> {
    await this.poolManager.closeAll()
  }

  /**
   * 关闭指定连接池
   */
  async close(connectionId: string): Promise<void> {
    await this.poolManager.close(connectionId)
  }

  /**
   * 获取连接池状态
   */
  getPoolStats() {
    return this.poolManager.getStats()
  }
}

/**
 * 使用示例：
 *
 * ```typescript
 * import { MultiSqlExecutor } from '@/connector/executors/multi-sql'
 *
 * const executor = new MultiSqlExecutor()
 *
 * // SQLite 查询
 * const sqliteResult = await executor.execute({
 *   connection_id: 'ems-sqlite',
 *   allow_write: false,
 *   max_rows: 100,
 *   query_template: 'SELECT * FROM energy_readings WHERE device_id = :device_id',
 * }, { device_id: 'device-001' })
 *
 * // PostgreSQL 查询（需要配置环境变量）
 * // DB_EMS_PG_HOST=localhost
 * // DB_EMS_PG_PORT=5432
 * // DB_EMS_PG_DATABASE=energy_db
 * // DB_EMS_PG_USER=user
 * // DB_EMS_PG_PASSWORD=password
 * const pgResult = await executor.execute({
 *   connection_id: 'ems-pg',
 *   allow_write: false,
 *   max_rows: 100,
 *   query_template: 'SELECT * FROM readings WHERE recorded_at > :start_time',
 * }, { start_time: '2024-01-01' })
 *
 * // MySQL 查询（需要配置环境变量）
 * // DB_EMS_MYSQL_HOST=localhost
 * // DB_EMS_MYSQL_PORT=3306
 * // DB_EMS_MYSQL_DATABASE=energy_db
 * // DB_EMS_MYSQL_USER=user
 * // DB_EMS_MYSQL_PASSWORD=password
 * ```
 */