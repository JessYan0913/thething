import fs from 'fs'
import path from 'path'

import type { ModelAliases } from '../model';

export interface GlobalConfig {
  apiKey?: string
  baseURL?: string
  /** 自定义配置目录路径（如不设置则默认 ~/.thething） */
  configDir?: string
  /** 模型别名映射（default 用作默认模型） */
  modelAliases?: Partial<ModelAliases>
}

const CONFIG_FILENAME = 'config.json'

/**
 * 获取全局配置文件路径
 *
 * 解析顺序：
 * 1. 显式传入的 configDir（最高优先级）
 * 2. 环境变量 THETHING_GLOBAL_CONFIG_DIR（部署级覆盖）
 * 3. 均未提供时返回空字符串（loadGlobalConfig 返回 null）
 */
function getConfigPath(configDir?: string): string {
  const dir = configDir || process.env.THETHING_GLOBAL_CONFIG_DIR;
  if (!dir) return '';
  return path.join(dir, CONFIG_FILENAME)
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
