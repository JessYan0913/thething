import fs from 'fs'
import path from 'path'
import os from 'os'

export interface GlobalConfig {
  apiKey?: string
  baseURL?: string
  /** 模型别名映射（default 用作默认模型） */
  modelAliases?: {
    fast?: string
    smart?: string
    default?: string
  }
}

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.thething')
const CONFIG_FILENAME = 'config.json'

function getConfigPath(configDir?: string): string {
  return path.join(configDir || process.env.THETHING_GLOBAL_CONFIG_DIR || DEFAULT_CONFIG_DIR, CONFIG_FILENAME)
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function loadGlobalConfig(configDir?: string): GlobalConfig | null {
  const configPath = getConfigPath(configDir)
  if (!fs.existsSync(configPath)) return null

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(content) as GlobalConfig
  } catch {
    return null
  }
}

export function saveGlobalConfig(config: GlobalConfig, configDir?: string): void {
  const configPath = getConfigPath(configDir)
  ensureDir(path.dirname(configPath))
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

export function getGlobalConfigPath(configDir?: string): string {
  return getConfigPath(configDir)
}
