// ============================================================
// DB Command - Database management
// ============================================================

import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { getDataDirConfig } from '../lib/data-dir'
import { getGlobalDataStore, SQLiteDataStore } from '@thething/core'

export interface DbOptions {}

/**
 * Show database path
 */
export async function dbPath(): Promise<void> {
  const dataDirConfig = getDataDirConfig()

  console.log(chalk.blue('Database'))
  console.log(chalk.gray(`  Path: ${dataDirConfig.dbPath}`))
  console.log(chalk.gray(`  Data directory: ${dataDirConfig.dataDir}`))

  // Check if database exists
  if (fs.existsSync(dataDirConfig.dbPath)) {
    const stats = fs.statSync(dataDirConfig.dbPath)
    console.log(chalk.gray(`  Size: ${(stats.size / 1024).toFixed(2)} KB`))
    console.log(chalk.green('  Status: Exists'))
  } else {
    console.log(chalk.yellow('  Status: Not yet created'))
  }
}

/**
 * Backup database
 */
export async function dbBackup(backupPath: string): Promise<void> {
  const dataDirConfig = getDataDirConfig()

  // Check if source database exists
  if (!fs.existsSync(dataDirConfig.dbPath)) {
    console.log(chalk.red('Database does not exist.'))
    console.log(chalk.gray(`  Expected path: ${dataDirConfig.dbPath}`))
    return
  }

  // Ensure backup directory exists
  const backupDir = path.dirname(backupPath)
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }

  // Perform backup using SQLite backup API
  console.log(chalk.blue(`Backing up database to: ${backupPath}`))

  try {
    const store = getGlobalDataStore()
    if (store instanceof SQLiteDataStore) {
      const db = store.getRawDb()
      await db.backup(backupPath)
      console.log(chalk.green('Backup completed successfully.'))
    } else {
      // Fallback for non-SQLite stores: file copy
      console.log(chalk.yellow('Using file copy fallback (non-SQLite store)...'))
      fs.copyFileSync(dataDirConfig.dbPath, backupPath)
      console.log(chalk.green('Backup completed (via file copy).'))
    }
  } catch (error) {
    // Fallback: copy file
    console.log(chalk.yellow('Using file copy fallback...'))
    fs.copyFileSync(dataDirConfig.dbPath, backupPath)
    console.log(chalk.green('Backup completed (via file copy).'))
  }
}

// Export as module
export default {
  path: dbPath,
  backup: dbBackup,
}