// ============================================================
// Configuration Store
// ============================================================

import fs from 'fs'
import path from 'path'
import os from 'os'

// 环境变量: THETHING_GLOBAL_CONFIG_DIR
// 允许用户自定义全局配置目录（替代 ~/.thething）
const CONFIG_DIR = process.env.THETHING_GLOBAL_CONFIG_DIR || path.join(os.homedir(), '.thething')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export interface AppConfig {
  api?: {
    key?: string
    baseUrl?: string
  }
  default?: {
    model?: string
    port?: number
    dataDir?: string
  }
}

const DEFAULT_CONFIG: AppConfig = {}

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

/**
 * Load config from file
 */
export function loadConfig(): AppConfig {
  ensureConfigDir()

  if (!fs.existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(content) as AppConfig
  } catch {
    return DEFAULT_CONFIG
  }
}

/**
 * Save config to file
 */
export function saveConfig(config: AppConfig): void {
  ensureConfigDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

/**
 * Set a config value
 */
export function setConfigValue(key: string, value: string): void {
  const config = loadConfig()

  // Parse key path (e.g., "api.key" -> { api: { key: value } })
  const parts = key.split('.')
  let current = config as Record<string, unknown>

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!current[part]) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]] = value
  saveConfig(config)
}

/**
 * Get config file path
 */
export function getConfigPath(): string {
  return CONFIG_FILE
}