// ============================================================
// Connectors Loader
// ============================================================
//
// 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
// 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。

import { parsePlainYamlFile } from '../../foundation/parser';
import { scanDirs, mergeByPriority, LoadingCache } from '../../foundation/scanner';
import { getUserConfigDir, getProjectConfigDir } from '../../foundation/paths';
import type { ConnectorFrontmatter } from '../../extensions/connector/loader';
import { ConnectorFrontmatterSchema } from '../../extensions/connector/loader';

// ============================================================
// 扩展类型
// ============================================================

interface ConnectorWithSource extends ConnectorFrontmatter {
  source: 'user' | 'project';
  filePath: string;
}

// ============================================================
// 缓存
// ============================================================

const connectorsCache = new LoadingCache<ConnectorFrontmatter[]>();

// ============================================================
// 加载选项
// ============================================================

export interface LoadConnectorsOptions {
  cwd?: string;
  sources?: ('user' | 'project')[];
}

// ============================================================
// 加载函数
// ============================================================

/**
 * 加载 Connectors 配置
 *
 * 注意：configDirName 从全局单例 getResolvedConfigDirName() 获取
 *
 * @param options 加载选项
 * @returns ConnectorFrontmatter 列表
 */
export async function loadConnectors(options?: LoadConnectorsOptions): Promise<ConnectorFrontmatter[]> {
  const cwd = options?.cwd ?? process.cwd();
  const sources = options?.sources ?? ['user', 'project'];

  // 检查缓存
  const cacheKey = `connectors:${cwd}`;
  const cached = connectorsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 构建扫描目录（使用全局 configDirName）
  const dirs: string[] = [];
  if (sources.includes('user')) {
    dirs.push(getUserConfigDir('connectors'));
  }
  if (sources.includes('project')) {
    dirs.push(getProjectConfigDir(cwd, 'connectors'));
  }

  // 扫描 YAML 文件
  const yamlResults = await scanDirs(dirs, { pattern: '*.yaml' });
  const ymlResults = await scanDirs(dirs, { pattern: '*.yml' });
  const allResults = [...yamlResults, ...ymlResults];

  // 去重
  const seenPaths = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seenPaths.has(r.filePath)) return false;
    seenPaths.add(r.filePath);
    return true;
  });

  // 加载每个文件
  const connectors: ConnectorWithSource[] = [];
  for (const result of uniqueResults) {
    try {
      const connector = await loadConnectorFile(result.filePath, result.source);
      connectors.push(connector);
    } catch (error) {
      console.warn(`[ConnectorsLoader] Failed to load ${result.filePath}: ${(error as Error).message}`);
    }
  }

  // 合并（project > user）
  const merged = mergeByPriority(
    connectors,
    ['project', 'user'],
    (c) => c.id,
  );

  // 去除 source 和 filePath 字段
  const result: ConnectorFrontmatter[] = merged.map((c) => ({
    id: c.id,
    name: c.name,
    version: c.version,
    description: c.description,
    enabled: c.enabled,
    inbound: c.inbound,
    auth: c.auth,
    credentials: c.credentials,
    custom_settings: c.custom_settings,
    base_url: c.base_url,
    tools: c.tools,
  }));

  // 更新缓存
  connectorsCache.set(cacheKey, result);

  return result;
}

/**
 * 加载单个 Connector 配置文件
 *
 * @param filePath 文件路径
 * @param source 来源
 * @returns ConnectorFrontmatter with source
 */
export async function loadConnectorFile(
  filePath: string,
  source: 'user' | 'project',
): Promise<ConnectorWithSource> {
  const result = await parsePlainYamlFile(filePath, ConnectorFrontmatterSchema);

  // 环境变量替换
  const processed = replaceEnvVars(result.data as Record<string, unknown>);

  return {
    ...processed as ConnectorFrontmatter,
    source,
    filePath: result.filePath,
  };
}

// ============================================================
// 环境变量替换
// ============================================================

function replaceEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = replaceEnvVarInString(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'string') {
          return replaceEnvVarInString(item);
        } else if (typeof item === 'object' && item !== null) {
          return replaceEnvVars(item as Record<string, unknown>);
        }
        return item;
      });
    } else if (typeof value === 'object' && value !== null) {
      result[key] = replaceEnvVars(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function replaceEnvVarInString(str: string): string {
  return str
    .replace(/\$\{(\w+)\}/g, (_, varName) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        console.warn(`[ConnectorsLoader] Environment variable ${varName} not found`);
        return str;
      }
      return envValue;
    })
    .replace(/\$(\w+)/g, (_, varName) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        return str;
      }
      return envValue;
    });
}

/**
 * 清除缓存
 */
export function clearConnectorsCache(): void {
  connectorsCache.clear();
}