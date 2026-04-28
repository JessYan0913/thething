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