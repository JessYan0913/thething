// ============================================================
// Server Config - Server 项目目录配置
// ============================================================

import path from 'path'
import { fileURLToPath } from 'url'

/**
 * 获取 Server 项目目录
 *
 * Server 作为独立应用有自己的配置目录 (.thething/)
 * 这与 monorepo 开发模式下的 resolveProjectDir() 不同：
 * - resolveProjectDir() 在 monorepo 中返回根目录（当配置 monorepoPatterns）
 * - getServerProjectDir() 返回 server 包自己的目录
 *
 * 支持环境变量覆盖，便于生产部署时自定义配置路径
 */
export function getServerProjectDir(): string {
  // 环境变量优先（支持生产部署时自定义）
  if (process.env.THETHING_PROJECT_DIR) {
    return process.env.THETHING_PROJECT_DIR
  }

  // 使用 import.meta.url 获取当前模块的实际位置
  // 在 ES modules 中，__dirname 不可靠（tsx 运行时指向入口文件目录）
  const currentModulePath = fileURLToPath(import.meta.url)
  // config.ts 位于 packages/server/src/config.ts
  // 向上一级是 packages/server/src，再向上一级是 packages/server
  return path.resolve(path.dirname(currentModulePath), '..')
}

/**
 * 获取 Server 配置目录
 *
 * @param subdir 子目录名（如 'skills', 'agents', 'permissions' 等）
 * @returns 目录绝对路径
 */
export function getServerConfigDir(subdir?: string): string {
  const projectDir = getServerProjectDir()
  if (subdir) {
    return path.join(projectDir, '.thething', subdir)
  }
  return path.join(projectDir, '.thething')
}

/**
 * 获取 Server 数据目录
 *
 * @returns 数据目录绝对路径
 */
export function getServerDataDir(): string {
  const projectDir = getServerProjectDir()
  return path.join(projectDir, '.thething', 'data')
}

/**
 * 获取 Server Tokenizer 配置
 *
 * 符合 core-redesign.md 理念：环境变量由应用层处理，不传入 core
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

  // tokenizer 目录
  if (process.env.THETHING_TOKENIZER_DIR) {
    config.dir = process.env.THETHING_TOKENIZER_DIR
  }

  // 禁用自动下载
  if (process.env.THETHING_TOKENIZER_DISABLE_AUTO_DOWNLOAD === 'true') {
    config.disableAutoDownload = true
  }

  // 预加载模型列表
  if (process.env.THETHING_TOKENIZER_PRELOAD) {
    config.preloadModels = process.env.THETHING_TOKENIZER_PRELOAD.split(',').map(s => s.trim())
  }

  return config
}