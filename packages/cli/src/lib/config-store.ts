import path from 'path'
import os from 'os'
import { loadGlobalConfig, saveGlobalConfig, getGlobalConfigPath, type GlobalConfig } from '@the-thing/core'

export type { GlobalConfig }

// Dot Agents 协议：配置来自 .agents/
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.agents')

export function loadConfig(): GlobalConfig {
  return loadGlobalConfig(GLOBAL_CONFIG_DIR) ?? {}
}

export function saveConfig(config: GlobalConfig): void {
  saveGlobalConfig(config, GLOBAL_CONFIG_DIR)
}

/**
 * 兼容旧的 `thething config set <key> <value>` 命令。
 * apiKey/baseURL/model 映射到 providers 分组格式的默认条目
 * (defaultModel 所在供应商;没有则创建一个);其他键原样写入顶层。
 */
export function setConfigValue(key: string, value: string): void {
  const config = loadConfig()
  if (key === 'apiKey' || key === 'baseURL' || key === 'model') {
    const providers = (config.providers ?? []).map(p => ({ ...p, models: [...p.models] }))
    // 定位 defaultModel 所在供应商,没有则用第一个,再没有就新建
    let idx = providers.findIndex(p => p.models.some(m => m.id === config.defaultModel))
    if (idx < 0 && providers.length > 0) idx = 0
    if (idx < 0) {
      providers.push({ name: '', baseURL: '', apiKey: '', models: [] })
      idx = 0
    }
    const provider = providers[idx]
    if (key === 'apiKey') provider.apiKey = value
    if (key === 'baseURL') {
      provider.baseURL = value
      if (!provider.name) provider.name = value
    }
    let defaultModel = config.defaultModel
    if (key === 'model') {
      const oldDefault = config.defaultModel
      const existing = provider.models.findIndex(m => m.id === oldDefault)
      if (existing >= 0) {
        provider.models[existing] = { ...provider.models[existing], id: value }
      } else if (!provider.models.some(m => m.id === value)) {
        provider.models.push({ id: value })
      }
      defaultModel = value
    }
    saveConfig({ ...config, providers, defaultModel })
    return
  }
  ;(config as Record<string, unknown>)[key] = value
  saveConfig(config)
}

export function getConfigPath(): string {
  return getGlobalConfigPath(GLOBAL_CONFIG_DIR)
}
