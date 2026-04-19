// ============================================================
// SQL Executor - 数据库直连查询（只读，防 SQL 注入）
// ============================================================

import { getDatabase, type SqliteDatabase, type SqliteDatabaseConstructor } from '../../native-loader'
import type { SqlExecutorConfig, ExecutorResult } from '../types'

export interface SqlExecutorDeps {
  getDbPath: (connectionId: string) => Promise<string>
}

export class SqlExecutor {
  private connectionPool = new Map<string, SqliteDatabase>()

  constructor(
    private deps: SqlExecutorDeps
  ) {}

  async execute(
    config: SqlExecutorConfig,
    input: Record<string, unknown>
  ): Promise<ExecutorResult> {
    const startTime = Date.now()

    try {
      if (!config.allow_write) {
        this.assertReadOnly(config.query_template)
      }

      const db = await this.getConnection(config.connection_id)

      const { sql, params } = this.bindParameters(config.query_template, input)

      const stmt = db.prepare(sql)
      const rows = stmt.all(...params) as Record<string, unknown>[]

      const maxRows = config.max_rows ?? 100
      const truncated = rows.length > maxRows
      const resultRows = truncated ? rows.slice(0, maxRows) : rows

      return {
        success: true,
        data: {
          rows: resultRows,
          row_count: resultRows.length,
          total_count: rows.length,
          truncated,
        },
        metadata: { duration_ms: Date.now() - startTime, connection_id: config.connection_id },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { duration_ms: Date.now() - startTime },
      }
    }
  }

  private assertReadOnly(sql: string): void {
    const normalized = sql.trim().toUpperCase()
    const writeKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'REPLACE']
    for (const kw of writeKeywords) {
      if (new RegExp('\\b' + kw + '\\b').test(normalized)) {
        throw new Error('SQL_WRITE_NOT_ALLOWED: ' + kw)
      }
    }
  }

  private bindParameters(
    template: string,
    input: Record<string, unknown>
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = []
    const sql = template.replace(/:(\w+)/g, (_, name: string) => {
      if (!(name in input)) {
        throw new Error('Missing parameter: ' + name)
      }
      params.push(input[name])
      return '$' + params.length
    })
    return { sql, params }
  }

  private async getConnection(connectionId: string): Promise<SqliteDatabase> {
    if (!this.connectionPool.has(connectionId)) {
      const dbPath = await this.deps.getDbPath(connectionId)
      const Database = getDatabase() as SqliteDatabaseConstructor
      const db = new Database(dbPath, { readonly: true })
      db.pragma('journal_mode = WAL')
      this.connectionPool.set(connectionId, db)
    }
    return this.connectionPool.get(connectionId)!
  }

  closeAll(): void {
    for (const db of this.connectionPool.values()) {
      db.close()
    }
    this.connectionPool.clear()
  }

  close(connectionId: string): void {
    const db = this.connectionPool.get(connectionId)
    if (db) {
      db.close()
      this.connectionPool.delete(connectionId)
    }
  }
}
