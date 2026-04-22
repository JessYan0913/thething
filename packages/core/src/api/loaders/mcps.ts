// ============================================================
// MCP Loader
// ============================================================

import { parseJsonFile } from '../../foundation/parser';
import { scanDirs, mergeByPriority, LoadingCache } from '../../foundation/scanner';
import { detectProjectDir, getUserConfigDir, getProjectConfigDir } from '../../foundation/paths';
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
// 加载函数
// ============================================================

/**
 * 加载 MCP Servers 配置
 *
 * @param options 加载选项
 * @returns McpServerConfig 列表
 */
export async function loadMcpServers(options?: LoadMcpsOptions): Promise<McpServerConfig[]> {
  const cwd = options?.cwd ?? detectProjectDir();
  const sources = options?.sources ?? ['user', 'project'];

  // 检查缓存
  const cacheKey = `mcps:${cwd}`;
  const cached = mcpsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 构建扫描目录
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