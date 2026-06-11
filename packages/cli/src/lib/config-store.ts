import path from 'path'
import os from 'os'
import { loadGlobalConfig, saveGlobalConfig, getGlobalConfigPath, type GlobalConfig } from '@the-thing/core'

export type { GlobalConfig }

const GLOBAL_CONFIG_DIR = process.env.THETHING_GLOBAL_CONFIG_DIR || path.join(os.homedir(), '.thething')

export function loadConfig(): GlobalConfig {
  return loadGlobalConfig(GLOBAL_CONFIG_DIR) ?? {}
}

export function saveConfig(config: GlobalConfig): void {
  saveGlobalConfig(config, GLOBAL_CONFIG_DIR)
}

export function setConfigValue(key: string, value: string): void {
  const config = loadConfig()
  ;(config as Record<string, unknown>)[key] = value
  saveConfig(config)
}

export function getConfigPath(): string {
  return getGlobalConfigPath(GLOBAL_CONFIG_DIR)
}
