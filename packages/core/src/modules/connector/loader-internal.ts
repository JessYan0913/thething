// ============================================================
// Connectors Loader - 基于 MultiSourceConfigLoader
// ============================================================

import { parsePlainYamlFile } from '../../primitives/parser';
import { createMultiSourceLoader } from '../../services/scanner/multi-source-loader';
import type { ConnectorFrontmatter } from './loader';
import { ConnectorFrontmatterSchema } from './loader';
import type { ConfigSource } from '../../primitives/constants';
import { logger } from '../../primitives/logger';

// ============================================================
// 扩展类型
// ============================================================

interface ConnectorWithSource extends ConnectorFrontmatter {
  source: ConfigSource;
  filePath: string;
}

// ============================================================
// Connector 变量解析
// ============================================================

/**
 * 解析 Connector YAML 中的变量声明。
 *
 * 1. 提取 `variables` 区域
 * 2. 递归替换整个 YAML 中的 ${{ var_name }} 引用
 *
 * @param obj 已解析的 YAML 对象
 * @returns 变量替换后的对象
 */
function resolveConnectorVars(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  // 1. 提取 variables
  const rawVars = (obj.variables ?? {}) as Record<string, string>;

  // 2. 递归遍历整个对象，替换 ${{ var_name }}
  return walkAndReplace(obj, rawVars) as Record<string, unknown>;
}

/**
 * 递归遍历值，将所有 `${{ var_name }}` 替换为变量值。
 * 未找到的变量名保留原样。
 */
function walkAndReplace(
  value: unknown,
  vars: Record<string, string>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{\{(\s*\w+\s*)\}\}/g, (match, varName) => {
      const trimmed = varName.trim();
      if (vars[trimmed] !== undefined) {
        return vars[trimmed];
      }
      logger.warn('ConnectorLoader', 'Variable reference \'${{ ' + trimmed + ' }}\' not found in variables — keeping as literal');
      return match;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => walkAndReplace(item, vars));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = walkAndReplace(v, vars);
    }
    return result;
  }
  return value;
}

// ============================================================
// MultiSource Loader
// ============================================================

const connectorsLoader = createMultiSourceLoader<ConnectorWithSource>({
  subcategory: 'connectors',
  filePattern: '*.yaml',
  filePatterns: ['*.yaml', '*.yml'],
  parse: async (filePath, source) => {
    const result = await parsePlainYamlFile(filePath, ConnectorFrontmatterSchema);
    const processed = resolveConnectorVars(result.data as Record<string, unknown>);

    return {
      ...processed as ConnectorFrontmatter,
      source,
      filePath: result.filePath,
    };
  },
  getMergeKey: (item) => item.id,
});

// ============================================================
// Public API
// ============================================================

export interface LoadConnectorsOptions {
  cwd?: string;
  sources?: ConfigSource[];
  dirs?: readonly string[];
  configDir?: string;
  homeDir?: string;
}

export async function loadConnectors(options?: LoadConnectorsOptions): Promise<ConnectorFrontmatter[]> {
  const items = await connectorsLoader.load({
    cwd: options?.cwd,
    configDir: options?.configDir,
    homeDir: options?.homeDir,
    dirs: options?.dirs,
  });

  return items.map((c) => ({
    id: c.id,
    name: c.name,
    version: c.version,
    description: c.description,
    enabled: c.enabled,
    variables: c.variables,
    inbound: c.inbound,
    auth: c.auth,
    custom_settings: c.custom_settings,
    base_url: c.base_url,
    tools: c.tools,
    sourcePath: c.filePath,
  }));
}

export async function loadConnectorFile(
  filePath: string,
  source: ConfigSource,
): Promise<ConnectorWithSource> {
  const result = await parsePlainYamlFile(filePath, ConnectorFrontmatterSchema);
  const processed = resolveConnectorVars(result.data as Record<string, unknown>);

  return {
    ...processed as ConnectorFrontmatter,
    source,
    filePath: result.filePath,
  };
}
