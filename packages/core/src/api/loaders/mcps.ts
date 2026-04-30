// ============================================================
// MCP Loader
// ============================================================
//
// 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
// 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。

import { parseJsonFile } from '../../foundation/parser';
import { scanDirs, mergeByPriority, LoadingCache } from '../../foundation/scanner';
import { getUserConfigDir, getProjectConfigDir } from '../../foundation/paths';
import type { McpServerConfig } from '../../extensions/mcp/types';
import { McpServerConfigSchema } from '../../extensions/mcp/types';

// ============================================================
// 扩展类型
// ============================================================

interface McpConfigWithSource extends McpServerConfig {
  source: 'user' | 'project';
  filePath: string;
}

// ============================================================
// 缓存
// ============================================================

const mcpsCache = new LoadingCache<McpServerConfig[]>();

// ============================================================
// 加载选项
// ============================================================

export interface LoadMcpsOptions {
  cwd?: string;
  sources?: ('user' | 'project')[];
}

// ============================================================
// 核心加载函数
// ============================================================

/**
 * 加载 MCP Servers 配置
 *
 * 注意：configDirName 从全局单例 getResolvedConfigDirName() 获取
 */
export async function loadMcpServers(options?: LoadMcpsOptions): Promise<McpServerConfig[]> {
  const cwd = options?.cwd ?? process.cwd();
  const sources = options?.sources ?? ['user', 'project'];

  // 检查缓存
  const cacheKey = `mcps:${cwd}`;
  const cached = mcpsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 构建扫描目录（使用全局 configDirName）
  const dirs: string[] = [];
  if (sources.includes('user')) {
    dirs.push(getUserConfigDir('mcps'));
  }
  if (sources.includes('project')) {
    dirs.push(getProjectConfigDir(cwd, 'mcps'));
  }

  // 扫描文件
  const scanResults = await scanDirs(dirs, { pattern: '*.json' });

  // 加载每个文件
  const mcps: McpConfigWithSource[] = [];
  for (const result of scanResults) {
    try {
      const mcp = await loadMcpFile(result.filePath, result.source);
      mcps.push(mcp);
    } catch (error) {
      console.warn(`[McpsLoader] Failed to load ${result.filePath}: ${(error as Error).message}`);
    }
  }

  // 合并（project > user）
  const merged = mergeByPriority(
    mcps,
    ['project', 'user'],
    (m) => m.name,
  );

  // 去除 source 和 filePath 字段
  const result: McpServerConfig[] = merged.map((m) => ({
    name: m.name,
    transport: m.transport,
    enabled: m.enabled,
    tools: m.tools,
    elicitation: m.elicitation,
  }));

  // 更新缓存
  mcpsCache.set(cacheKey, result);

  return result;
}

/**
 * 加载单个 MCP 配置文件
 *
 * @param filePath 文件路径
 * @param source 来源
 * @returns McpServerConfig with source
 */
export async function loadMcpFile(
  filePath: string,
  source: 'user' | 'project',
): Promise<McpConfigWithSource> {
  const result = await parseJsonFile(filePath, McpServerConfigSchema);

  return {
    name: result.data.name,
    transport: result.data.transport as McpServerConfig['transport'],
    enabled: result.data.enabled,
    tools: result.data.tools,
    elicitation: result.data.elicitation,
    source,
    filePath: result.filePath,
  };
}

/**
 * 清除缓存
 */
export function clearMcpsCache(): void {
  mcpsCache.clear();
}

// ============================================================
// 兼容接口（原 extensions/mcp/loader.ts）
// ============================================================

/**
 * MCP 加载配置（保留用于类型兼容）
 */
export interface McpLoaderConfig {
  sources?: ('user' | 'project')[];
}

/**
 * 扫描 MCP 配置目录（兼容接口）
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
 * 清除 MCP 加载缓存（兼容接口）
 */
export function clearMcpCache(): void {
  clearMcpsCache();
}

/**
 * 获取所有可用 MCP 服务器配置（兼容接口）
 *
 * @param cwd 当前工作目录
 * @returns MCP 服务器配置列表
 */
export async function getAvailableMcpServers(cwd?: string): Promise<McpServerConfig[]> {
  return loadMcpServers({ cwd });
}

/**
 * 模块版本（兼容接口）
 */
export const MCP_LOADER_MODULE_VERSION = '1.0.0';