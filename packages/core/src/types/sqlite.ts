// ============================================================
// SQLite Database Types - better-sqlite3 接口定义
// ============================================================
// 用于替代 better-sqlite3 的类型定义，支持 SEA 动态加载场景

/**
 * Statement 对象接口 - prepared statement
 */
export interface SqliteStatement {
  run(...params: unknown[]): SqliteStatement
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[] | undefined[]
  iterate(...params: unknown[]): IterableIterator<Record<string, unknown> | undefined>
  bind(...params: unknown[]): SqliteStatement
  pluck(toggle?: boolean): SqliteStatement
  expand(toggle?: boolean): SqliteStatement
  raw(toggle?: boolean): SqliteStatement
  columns(): Array<{ name: string; column: unknown; table: string; database: string; type: string }>
}

/**
 * Database 对象接口 - SQLite 数据库连接
 */
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T
  pragma(sql: string, simplify?: boolean): unknown
  exec(sql: string): SqliteDatabase
  close(): void

  // Properties
  readonly open: boolean
  readonly inTransaction: boolean
  readonly readonly: boolean
}

/**
 * Database 构造函数选项
 */
export interface SqliteDatabaseOptions {
  readonly?: boolean
  fileMustExist?: boolean
  timeout?: number
  verbose?: (message: unknown) => void
}

/**
 * Database 构造函数类型
 */
export interface SqliteDatabaseConstructor {
  new (filename: string, options?: SqliteDatabaseOptions): SqliteDatabase
}