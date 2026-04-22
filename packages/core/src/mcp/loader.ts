import { parseJsonFile } from '../parser';
import { scanConfigDirs, mergeByPriority, LoadingCache } from '../scanner';
import { detectProjectDir, getUserConfigDir, getProjectConfigDir } from '../paths';
import {
  McpServerConfigSchema,
  DEFAULT_MCP_LOADER_CONFIG,
  type McpServerConfig,
  type McpServerConfigSource,
  type McpLoaderConfig,
} from './types';

// ============================================================
// MCP 加载缓存
// ============================================================

const mcpCache = new LoadingCache<McpServerConfig[]>({
  ttlMs: 60_000,
  maxEntries: 10,
});

// ============================================================
// MCP 配置加载
// ============================================================

/**
 * 从 JSON 文件加载 MCP 服务器配置
 *
 * @param filePath JSON 文件路径
 * @param source 来源标识
 * @returns MCP 服务器配置（带来源信息）
 */
export async function loadMcpConfig(
  filePath: string,
  source: 'user' | 'project',
): Promise<McpServerConfigSource> {
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
 * 扫描 MCP 配置目录
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 * @param config 加载配置
 * @returns MCP 服务器配置列表
 */
export async function scanMcpDirs(
  cwd?: string,
  config?: Partial<McpLoaderConfig>,
): Promise<McpServerConfig[]> {
  const effectiveCwd = cwd ?? detectProjectDir();
  const resolvedConfig = { ...DEFAULT_MCP_LOADER_CONFIG, ...config };

  // 检查缓存
  const cacheKey = `mcps:${effectiveCwd}`;
  if (resolvedConfig.enableCache) {
    const cached = mcpCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const configs: McpServerConfigSource[] = [];
  const dirs: string[] = [];

  // 用户全局目录
  if (resolvedConfig.sources?.includes('user')) {
    dirs.push(getUserConfigDir('mcps'));
  }

  // 项目级目录
  if (resolvedConfig.sources?.includes('project')) {
    dirs.push(getProjectConfigDir(effectiveCwd, 'mcps'));
  }

  // 扫描目录
  const scanResults = await scanConfigDirs(effectiveCwd, {
    dirs,
    filePattern: '*.json',
    recursive: false,
  });

  // 加载每个文件
  for (const result of scanResults) {
    try {
      const mcpConfig = await loadMcpConfig(result.filePath, result.source as 'user' | 'project');
      configs.push(mcpConfig);

      if (resolvedConfig.maxServers && configs.length >= resolvedConfig.maxServers) {
        break;
      }
    } catch (error) {
      console.warn(`[McpLoader] Failed to load ${result.filePath}: ${(error as Error).message}`);
    }
  }

  // 按优先级合并（project > user）
  const merged = mergeByPriority(
    configs,
    ['project', 'user'],
    (cfg) => cfg.name,
  );

  // 去除来源元数据，返回纯 McpServerConfig
  const result: McpServerConfig[] = merged.map((cfg) => ({
    name: cfg.name,
    transport: cfg.transport,
    enabled: cfg.enabled,
    tools: cfg.tools,
    elicitation: cfg.elicitation,
  }));

  // 更新缓存
  if (resolvedConfig.enableCache) {
    mcpCache.set(cacheKey, result);
  }

  return result;
}

/**
 * 清除 MCP 加载缓存
 */
export function clearMcpCache(): void {
  mcpCache.clear();
}

/**
 * 获取所有可用 MCP 服务器配置
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 * @returns MCP 服务器配置列表
 */
export async function getAvailableMcpServers(cwd?: string): Promise<McpServerConfig[]> {
  return scanMcpDirs(cwd);
}

// ============================================================
// Module Version
// ============================================================

export const MCP_LOADER_MODULE_VERSION = '1.0.0';