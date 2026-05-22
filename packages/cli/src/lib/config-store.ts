import { loadGlobalConfig, saveGlobalConfig, getGlobalConfigPath, type GlobalConfig } from '@the-thing/core'

export type { GlobalConfig }

export function loadConfig(): GlobalConfig {
  return loadGlobalConfig() ?? {}
}

export function saveConfig(config: GlobalConfig): void {
  saveGlobalConfig(config)
}

export function setConfigValue(key: string, value: string): void {
  const config = loadConfig()
  ;(config as Record<string, unknown>)[key] = value
  saveConfig(config)
}

export function getConfigPath(): string {
  return getGlobalConfigPath()
}
