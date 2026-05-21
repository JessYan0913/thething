// ============================================================
// Connectors Loader - 基于 MultiSourceConfigLoader
// ============================================================

import { parsePlainYamlFile } from '../../primitives/parser';
import { createMultiSourceLoader } from '../../services/scanner/multi-source-loader';
import type { ConnectorFrontmatter } from './loader';
import { ConnectorFrontmatterSchema } from './loader';
import { logger } from '../../primitives/logger';
import type { ConfigSource } from '../../primitives/constants';

// ============================================================
// 扩展类型
// ============================================================

interface ConnectorWithSource extends ConnectorFrontmatter {
  source: ConfigSource;
  filePath: string;
}

// ============================================================
// 环境变量替换
// ============================================================

function replaceEnvVars(
  obj: Record<string, unknown>,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = replaceEnvVarInString(value, env);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'string') {
          return replaceEnvVarInString(item, env);
        } else if (typeof item === 'object' && item !== null) {
          return replaceEnvVars(item as Record<string, unknown>, env);
        }
        return item;
      });
    } else if (typeof value === 'object' && value !== null) {
      result[key] = replaceEnvVars(value as Record<string, unknown>, env);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function replaceEnvVarInString(str: string, env: Record<string, string | undefined>): string {
  return str
    .replace(/\$\{(\w+)\}/g, (_, varName) => {
      const envValue = env[varName];
      if (envValue === undefined) {
        logger.warn('ConnectorsLoader', `Environment variable ${varName} not found`);
        return str;
      }
      return envValue;
    })
    .replace(/\$(\w+)/g, (_, varName) => {
      const envValue = env[varName];
      if (envValue === undefined) {
        return str;
      }
      return envValue;
    });
}

// ============================================================
// MultiSource Loader
// ============================================================

let cachedEnv: Record<string, string | undefined> = {};

const connectorsLoader = createMultiSourceLoader<ConnectorWithSource>({
  subcategory: 'connectors',
  filePattern: '*.yaml',
  filePatterns: ['*.yaml', '*.yml'],
  parse: async (filePath, source) => {
    const result = await parsePlainYamlFile(filePath, ConnectorFrontmatterSchema);
    const processed = replaceEnvVars(result.data as Record<string, unknown>, cachedEnv);

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
  configDirName?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

export async function loadConnectors(options?: LoadConnectorsOptions): Promise<ConnectorFrontmatter[]> {
  cachedEnv = options?.env ?? {};

  const items = await connectorsLoader.load({
    cwd: options?.cwd,
    configDirName: options?.configDirName,
    homeDir: options?.homeDir,
    dirs: options?.dirs,
  });

  return items.map((c) => ({
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
    sourcePath: c.filePath,
  }));
}

export async function loadConnectorFile(
  filePath: string,
  source: ConfigSource,
  env: Record<string, string | undefined> = {},
): Promise<ConnectorWithSource> {
  const result = await parsePlainYamlFile(filePath, ConnectorFrontmatterSchema);
  const processed = replaceEnvVars(result.data as Record<string, unknown>, env);

  return {
    ...processed as ConnectorFrontmatter,
    source,
    filePath: result.filePath,
  };
}

