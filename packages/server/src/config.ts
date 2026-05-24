// ============================================================
// Server Config - Server 布局配置
// ============================================================

import {
  ENV_RESOURCE_ROOT,
  ENV_DATA_DIR,
  ENV_CONFIG_DIR_NAME,
} from './env-names'

/**
 * 默认配置目录名称
 */
const DEFAULT_CONFIG_DIR_NAME = '.thething'

/**
 * 获取 Server Layout 配置
 *
 * resourceRoot 默认为 process.cwd()，即用户当前工作目录。
 * CLI 下 cd 到项目目录启动，桌面端打开项目时传入项目路径。
 *
 * 支持的环境变量：
 * - THETHING_RESOURCE_ROOT: 项目根目录（默认为 cwd）
 * - THETHING_DATA_DIR: 数据目录路径（默认为 ~/.thething/data）
 * - THETHING_CONFIG_DIR_NAME: 配置目录名称（默认 '.thething'）
 */
export function getServerLayoutConfig(): {
  resourceRoot: string;
  dataDir?: string;
  configDirName: string;
} {
  const resourceRoot = process.env[ENV_RESOURCE_ROOT] || process.cwd()
  const configDirName = process.env[ENV_CONFIG_DIR_NAME] || DEFAULT_CONFIG_DIR_NAME
  const dataDir = process.env[ENV_DATA_DIR] || undefined

  return {
    resourceRoot,
    ...(dataDir ? { dataDir } : {}),
    configDirName,
  }
}