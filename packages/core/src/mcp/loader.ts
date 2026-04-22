// ============================================================
// MCP Loader - 统一加载器代理
// ============================================================
//
// 改造说明：此文件现在代理到 loaders/mcps.ts，保持 API 兼容
// 实际加载逻辑在 loaders/mcps.ts 中
//

import {
  loadMcpServers,
  clearMcpsCache,
} from '../loaders/mcps';
import type {
  McpServerConfig,
  McpLoaderConfig,
} from './types';

// ============================================================
// 代理函数（保持原有 API）
// ============================================================

/**
 * 扫描 MCP 配置目录
 *
 * @param cwd 当前工作目录
 * @param config 加载配置（部分支持）
 * @returns MCP 服务器配置列表
 */
export async function scanMcpDirs(
  cwd?: string,
  config?: Partial<McpLoaderConfig>,
): Promise<McpServerConfig[]> {
  return loadMcpServers({
    cwd,
    sources: config?.sources as ('user' | 'project')[] | undefined,
  });
}

/**
 * 清除 MCP 加载缓存
 */
export function clearMcpCache(): void {
  clearMcpsCache();
}

/**
 * 获取所有可用 MCP 服务器配置
 *
 * @param cwd 当前工作目录
 * @returns MCP 服务器配置列表
 */
export async function getAvailableMcpServers(cwd?: string): Promise<McpServerConfig[]> {
  return loadMcpServers({ cwd });
}

// ============================================================
// Module Version
// ============================================================

export const MCP_LOADER_MODULE_VERSION = '1.0.0';

// Re-export types for backward compatibility
export type { McpLoaderConfig } from './types';