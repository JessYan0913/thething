// ============================================================
// Native Module Loader for SEA (Single Executable Application)
// ============================================================
// In SEA mode, the standard require() only supports built-in modules.
// To load external modules, we need to use require("module").createRequire().
//
// Strategy: Use the better-sqlite3 npm package's lib/ wrapper files
// which properly implement methods like pragma, transaction, etc.
// These wrappers use the native addon's prepare() method internally.

import path from 'path'
import fs from 'fs'
import module from 'module'
import type { SqliteDatabase, SqliteDatabaseConstructor } from './types/sqlite'

// Re-export SQLite types for use across the codebase
export type { SqliteDatabase, SqliteDatabaseConstructor, SqliteDatabaseOptions, SqliteStatement } from './types/sqlite'

// Cache for loaded native modules
const nativeModuleCache: Map<string, any> = new Map()

/**
 * Find the better-sqlite3 package directory (contains lib/)
 */
function findBetterSqlite3PackageDir(): string | null {
  const execDir = path.dirname(process.execPath)
  const nativeFileName = 'better_sqlite3.node'

  // Check if native/better-sqlite3/lib/index.js exists (SEA portable mode)
  const portableLibPath = path.join(execDir, 'native', 'better-sqlite3', 'lib', 'index.js')
  if (fs.existsSync(portableLibPath)) {
    return path.join(execDir, 'native', 'better-sqlite3')
  }

  // Check current working directory
  const cwdLibPath = path.join(process.cwd(), 'native', 'better-sqlite3', 'lib', 'index.js')
  if (fs.existsSync(cwdLibPath)) {
    return path.join(process.cwd(), 'native', 'better-sqlite3')
  }

  return null
}

/**
 * Create a custom bindings module that returns the native addon
 * This replaces the npm bindings package's behavior
 */
function createBindingsModule(nativeAddonPath: string): any {
  return function bindings(moduleName: string): any {
    // Load the native addon directly
    const externalRequire = module.createRequire(process.execPath)
    return externalRequire(nativeAddonPath)
  }
}

/**
 * Create a custom require function for the better-sqlite3 package
 * This handles the special require('bindings') call in database.js
 */
function createPackageRequire(packageDir: string): NodeRequire {
  const nativeAddonPath = path.join(packageDir, 'build', 'Release', 'better_sqlite3.node')

  // Create a require function based on the package directory
  const baseRequire = module.createRequire(path.join(packageDir, 'lib', 'index.js'))

  // Create a custom require that intercepts 'bindings' calls
  const customRequire = (id: string) => {
    if (id === 'bindings') {
      return createBindingsModule(nativeAddonPath)
    }
    return baseRequire(id)
  }

  // Copy properties from base require
  customRequire.resolve = baseRequire.resolve
  customRequire.cache = baseRequire.cache
  customRequire.extensions = baseRequire.extensions
  customRequire.main = baseRequire.main

  return customRequire as NodeRequire
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

  // SEA mode: load from native/better-sqlite3 package
  const packageDir = findBetterSqlite3PackageDir()
  if (!packageDir) {
    throw new Error(
      `Failed to find better-sqlite3 package. ` +
      `Please ensure the native module is compiled for your platform (${process.platform}-${process.arch}). ` +
      `Run 'pnpm rebuild better-sqlite3' to compile.`
    )
  }

  console.log(`[NativeLoader] Loading better-sqlite3 from ${packageDir}`)

  // Create custom require for this package
  const customRequire = createPackageRequire(packageDir)

  // Load the lib/index.js which exports Database
  const libIndexPath = path.join(packageDir, 'lib', 'index.js')
  const Database = customRequire(libIndexPath)

  nativeModuleCache.set('better-sqlite3', Database)
  console.log('[NativeLoader] Successfully loaded better-sqlite3 Database class')

  return Database as SqliteDatabaseConstructor
}

/**
 * Get Database class from better-sqlite3
 */
export function getDatabase(): SqliteDatabaseConstructor {
  return loadBetterSqlite3()
}