// ============================================================
// Data Directory Management
// ============================================================

import os from 'os'
import path from 'path'
import fs from 'fs'

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.thething', 'data')

export interface DataDirConfig {
  dataDir: string
  dbPath: string
  configPath: string
  lockPath: string
  logsPath: string
  credentialsPath: string
}

/**
 * Get or create data directory configuration
 */
export function getDataDirConfig(customDataDir?: string): DataDirConfig {
  const dataDir = customDataDir || DEFAULT_DATA_DIR

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  return {
    dataDir,
    dbPath: path.join(dataDir, 'chat.db'),
    configPath: path.join(dataDir, 'config.json'),
    lockPath: path.join(dataDir, 'server.lock'),
    logsPath: path.join(dataDir, 'logs'),
    credentialsPath: path.join(dataDir, 'credentials'),
  }
}

/**
 * Ensure subdirectories exist
 */
export function ensureDataDirSubdirs(config: DataDirConfig): void {
  if (!fs.existsSync(config.logsPath)) {
    fs.mkdirSync(config.logsPath, { recursive: true })
  }
  if (!fs.existsSync(config.credentialsPath)) {
    fs.mkdirSync(config.credentialsPath, { recursive: true })
  }
}

/**
 * Get default data directory path
 */
export function getDefaultDataDir(): string {
  return DEFAULT_DATA_DIR
}