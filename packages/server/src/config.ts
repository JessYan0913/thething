// ============================================================
// Server Config - Server 项目目录配置
// ============================================================

import path from 'path'
import { fileURLToPath } from 'url'
import {
  ENV_RESOURCE_ROOT,
  ENV_DATA_DIR,
  ENV_CONFIG_DIR_NAME,
} from './env-names'

/**
 * 获取 Server 项目目录
 *
 * 使用 import.meta.url 获取当前模块的实际位置
 * 在 ES modules 中，__dirname 不可靠（tsx 运行时指向入口文件目录）
 */
function getServerProjectDir(): string {
  const currentModulePath = fileURLToPath(import.meta.url)
  // config.ts 位于 packages/server/src/config.ts
  // 向上一级是 packages/server/src，再向上一级是 packages/server
  return path.resolve(path.dirname(currentModulePath), '..')
}

/**
 * 获取 Server Tokenizer 配置
 *
 * 支持的环境变量：
 * - THETHING_TOKENIZER_DIR: tokenizer 目录路径
 * - THETHING_TOKENIZER_DISABLE_AUTO_DOWNLOAD: 禁用自动下载 (true/false)
 * - THETHING_TOKENIZER_PRELOAD: 预加载模型列表 (逗号分隔)
 */
export function getServerTokenizerConfig(): {
  dir?: string;
  disableAutoDownload?: boolean;
  preloadModels?: string[];
} {
  const config: {
    dir?: string;
    disableAutoDownload?: boolean;
    preloadModels?: string[];
  } = {}

  if (process.env.THETHING_TOKENIZER_DIR) {
    config.dir = process.env.THETHING_TOKENIZER_DIR
  }

  if (process.env.THETHING_TOKENIZER_DISABLE_AUTO_DOWNLOAD === 'true') {
    config.disableAutoDownload = true
  }

  if (process.env.THETHING_TOKENIZER_PRELOAD) {
    config.preloadModels = process.env.THETHING_TOKENIZER_PRELOAD.split(',').map(s => s.trim())
  }

  return config
}

/**
 * 默认配置目录名称
 */
const DEFAULT_CONFIG_DIR_NAME = '.siact'

/**
 * 获取 Server Layout 配置
 *
 * 从环境变量读取布局配置，未设置时使用默认值。
 *
 * 支持的环境变量：
 * - THETHING_RESOURCE_ROOT: 项目根目录（默认为 server 包目录）
 * - THETHING_DATA_DIR: 数据目录路径（默认为 resourceRoot/.siact/data）
 * - THETHING_CONFIG_DIR_NAME: 配置目录名称（默认 '.siact'）
 */
export function getServerLayoutConfig(): {
  resourceRoot: string;
  dataDir: string;
  configDirName: string;
} {
  const defaultResourceRoot = getServerProjectDir()
  const resourceRoot = process.env[ENV_RESOURCE_ROOT] || defaultResourceRoot
  const configDirName = process.env[ENV_CONFIG_DIR_NAME] || DEFAULT_CONFIG_DIR_NAME
  const defaultDataDir = path.join(resourceRoot, configDirName, 'data')
  const dataDir = process.env[ENV_DATA_DIR] || defaultDataDir

  return {
    resourceRoot,
    dataDir,
    configDirName,
  }
}