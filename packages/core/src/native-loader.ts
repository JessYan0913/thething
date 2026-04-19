// ============================================================
// Native Module Loader for SEA (Single Executable Application)
// ============================================================
// In SEA mode, the standard require() only supports built-in modules.
// To load external modules, we need to use require("module").createRequire().

import path from 'path'
import fs from 'fs'
import module from 'module'
import type { SqliteDatabase, SqliteDatabaseConstructor } from './types/sqlite'

// Re-export SQLite types for use across the codebase
export type { SqliteDatabase, SqliteDatabaseConstructor, SqliteDatabaseOptions, SqliteStatement } from './types/sqlite'

// Cache for loaded native modules
const nativeModuleCache: Map<string, any> = new Map()

// Native addon reference (cached after first load)
let nativeAddon: any = null

/**
 * Create a require function that can load external modules in SEA mode
 * Uses process.execPath as the base for SEA compatibility
 */
function createExternalRequire(): NodeRequire {
  return module.createRequire(process.execPath)
}

/**
 * Find the native binding path (better_sqlite3.node)
 */
function findNativeBindingPath(): string | null {
  const execDir = path.dirname(process.execPath)
  const nativeFileName = 'better_sqlite3.node'

  const searchPaths: string[] = [
    // SEA portable mode - native/better-sqlite3/build/Release/
    path.join(execDir, 'native', 'better-sqlite3', 'build', 'Release', nativeFileName),
    // Alternative: native/better_sqlite3.node (direct)
    path.join(execDir, 'native', nativeFileName),
    // Current working directory
    path.join(process.cwd(), 'native', 'better-sqlite3', 'build', 'Release', nativeFileName),
    path.join(process.cwd(), 'native', nativeFileName),
  ]

  for (const searchPath of searchPaths) {
    if (fs.existsSync(searchPath)) {
      return searchPath
    }
  }

  return null
}

/**
 * Load the native addon directly
 */
function loadNativeAddon(): any {
  if (nativeAddon) {
    return nativeAddon
  }

  const bindingPath = findNativeBindingPath()
  if (bindingPath) {
    try {
      const externalRequire = createExternalRequire()
      nativeAddon = externalRequire(bindingPath)
      // Initialize error constructor
      if (nativeAddon.setErrorConstructor && !nativeAddon.isInitialized) {
        // Create a simple error class
        class SqliteError extends Error {
          code: string
          constructor(message: string, code: string) {
            super(message)
            this.code = code
            this.name = 'SqliteError'
          }
        }
        nativeAddon.setErrorConstructor(SqliteError)
        nativeAddon.isInitialized = true
      }
      console.log(`[NativeLoader] Loaded native addon from ${bindingPath}`)
      return nativeAddon
    } catch (err) {
      console.warn(`[NativeLoader] Failed to load native addon from ${bindingPath}:`, err)
    }
  }

  // Fall back to standard npm package (works in non-SEA mode)
  try {
    nativeAddon = require('better-sqlite3/build/Release/better_sqlite3.node')
    return nativeAddon
  } catch {
    // Try bindings
    try {
      const bindings = require('bindings')
      nativeAddon = bindings('better_sqlite3.node')
      return nativeAddon
    } catch {
      throw new Error(
        `Failed to load better-sqlite3 native module. ` +
        `Please ensure the native module is compiled for your platform (${process.platform}-${process.arch}). ` +
        `Run 'pnpm rebuild better-sqlite3' to compile.`
      )
    }
  }
}

// Symbol for internal native database reference (matches npm package's util.cppdb)
const CPPDB = Symbol('cppdb')

/**
 * Create a Database wrapper that mimics the npm package behavior
 * The native addon's methods expect different parameters than the npm package
 */
function createDatabaseWrapper(nativeAddon: any): any {
  const NativeDatabase = nativeAddon.Database

  class DatabaseWrapper {
    private [CPPDB]: any

    constructor(filename: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }) {
      // Convert npm-style options to native addon parameters
      const readonly = options?.readonly ?? false
      const fileMustExist = options?.fileMustExist ?? false
      const timeout = options?.timeout ?? 5000

      // Determine if anonymous/temporary
      const trimmedFilename = filename?.trim() ?? ''
      const anonymous = trimmedFilename === '' || trimmedFilename === ':memory:'

      // Ensure directory exists for non-anonymous databases
      if (!anonymous && !trimmedFilename.startsWith('file:')) {
        const dir = path.dirname(trimmedFilename)
        if (!fs.existsSync(dir)) {
          throw new TypeError('Cannot open database because the directory does not exist')
        }
      }

      // Create native database
      // Native addon signature: (filename, originalFilename, anonymous, readonly, fileMustExist, timeout, verbose, buffer)
      this[CPPDB] = new NativeDatabase(
        trimmedFilename,
        filename,
        anonymous,
        readonly,
        fileMustExist,
        timeout,
        null,  // verbose
        null   // buffer
      )
    }

    // Wrapper methods (match npm package signatures)
    prepare(sql: string): StatementWrapper {
      // Native prepare signature: (sql, databaseWrapper, unsafeMode)
      const stmt = this[CPPDB].prepare(sql, this, false)
      return new StatementWrapper(stmt, this)
    }

    transaction(fn: Function): any {
      return this[CPPDB].transaction(fn)
    }

    pragma(sql: string, simplify?: boolean): any {
      return this[CPPDB].pragma(sql, simplify)
    }

    exec(sql: string): this {
      this[CPPDB].exec(sql)
      return this
    }

    close(): void {
      this[CPPDB].close()
    }

    // Properties
    get open(): boolean {
      return this[CPPDB].open
    }

    get inTransaction(): boolean {
      return this[CPPDB].inTransaction
    }

    get readonly(): boolean {
      return this[CPPDB].readonly
    }
  }

  /**
   * Statement wrapper - proxies native statement methods
   */
  class StatementWrapper {
    private _stmt: any
    private _db: DatabaseWrapper

    constructor(stmt: any, db: DatabaseWrapper) {
      this._stmt = stmt
      this._db = db
    }

    run(...params: unknown[]): this {
      this._stmt.run(...params)
      return this
    }

    get(...params: unknown[]): any {
      return this._stmt.get(...params)
    }

    all(...params: unknown[]): any[] {
      return this._stmt.all(...params)
    }

    iterate(...params: unknown[]): any {
      return this._stmt.iterate(...params)
    }

    bind(...params: unknown[]): this {
      this._stmt.bind(...params)
      return this
    }

    pluck(toggle?: boolean): this {
      this._stmt.pluck(toggle)
      return this
    }

    expand(toggle?: boolean): this {
      this._stmt.expand(toggle)
      return this
    }

    raw(toggle?: boolean): this {
      this._stmt.raw(toggle)
      return this
    }

    columns(): any[] {
      return this._stmt.columns()
    }
  }

  return DatabaseWrapper
}

/**
 * Load better-sqlite3 Database constructor
 * Returns a Database class that works like the npm package
 */
export function loadBetterSqlite3(): SqliteDatabaseConstructor {
  // Check cache first
  if (nativeModuleCache.has('better-sqlite3')) {
    return nativeModuleCache.get('better-sqlite3') as SqliteDatabaseConstructor
  }

  // Try to load via npm package first (works in non-SEA mode)
  try {
    const Database = require('better-sqlite3') as SqliteDatabaseConstructor
    nativeModuleCache.set('better-sqlite3', Database)
    return Database
  } catch {
    // Fall back to SEA native loading
  }

  // SEA mode: load native addon and create wrapper
  const addon = loadNativeAddon()
  if (!addon) {
    throw new Error('Failed to load better-sqlite3 native addon')
  }

  const DatabaseWrapper = createDatabaseWrapper(addon) as SqliteDatabaseConstructor
  nativeModuleCache.set('better-sqlite3', DatabaseWrapper)
  console.log('[NativeLoader] Created Database wrapper for SEA mode')

  return DatabaseWrapper
}

/**
 * Get Database class from better-sqlite3
 */
export function getDatabase(): SqliteDatabaseConstructor {
  return loadBetterSqlite3()
}