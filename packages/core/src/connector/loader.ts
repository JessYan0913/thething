import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';
import { z } from 'zod';
import { getUserConfigDir, getProjectConfigDir, LoadingCache } from '../loading';

// ============================================================
// Connector Frontmatter Schema
// ============================================================

const AuthConfigSchema = z.object({
  type: z.enum(['none', 'api_key', 'bearer', 'custom']),
  config: z.record(z.string(), z.unknown()).optional(),
});

// 使用 z.any() 避免递归类型问题
const SchemaPropertySchema: z.ZodType<{
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: unknown;
  properties?: Record<string, unknown>;
}> = z.object({
  type: z.string(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  default: z.any().optional(),
  items: z.any().optional(),
  properties: z.record(z.string(), z.any()).optional(),
});

const InputSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), SchemaPropertySchema),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: InputSchemaSchema,
  retryable: z.boolean().optional(),
  timeout_ms: z.number().optional(),
  executor: z.enum(['http', 'sql', 'script', 'mock']),
  executor_config: z.unknown(), // 宽松验证，运行时根据 executor 类型校验
});

const InboundSchema = z.object({
  enabled: z.boolean(),
  webhook_path: z.string(),
  handler: z.string(),
});

const ConnectorFrontmatterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional().default('1.0.0'),
  description: z.string().optional().default(''),
  enabled: z.boolean().optional().default(true),
  inbound: InboundSchema.optional(),
  auth: AuthConfigSchema.optional().default({ type: 'none' as const, config: {} }),
  credentials: z.record(z.string(), z.string()).optional(),
  custom_settings: z.record(z.string(), z.unknown()).optional(),
  base_url: z.string().optional(),
  tools: z.array(ToolDefinitionSchema).optional().default([]),
});

export type ConnectorFrontmatter = z.infer<typeof ConnectorFrontmatterSchema>;

// ============================================================
// Connector Loader
// ============================================================

export interface ConnectorLoaderConfig {
  sources?: ('user' | 'project')[];
  maxConnectors?: number;
  enableCache?: boolean;
}

const DEFAULT_CONNECTOR_LOADER_CONFIG: Required<ConnectorLoaderConfig> = {
  sources: ['user', 'project'],
  maxConnectors: 50,
  enableCache: true,
};

const connectorCache = new LoadingCache<ConnectorFrontmatter[]>();

/**
 * 从 YAML 文件加载 Connector 定义
 */
export async function loadConnectorYaml(filePath: string): Promise<ConnectorFrontmatter> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  // 解析 YAML
  const raw = yaml.load(content) as Record<string, unknown>;

  // 替换环境变量
  const processed = replaceEnvVars(raw);

  // 验证 schema
  const validated = ConnectorFrontmatterSchema.safeParse(processed);

  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid connector config in ${absolutePath}: ${issues}`);
  }

  return validated.data;
}

/**
 * 替换环境变量 ${VAR_NAME} 或 $VAR_NAME
 */
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
        console.warn(`[ConnectorLoader] Environment variable ${varName} not found`);
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
 * 扫描 Connector 配置目录
 */
export async function scanConnectorDirs(
  cwd: string,
  config?: Partial<ConnectorLoaderConfig>,
): Promise<ConnectorFrontmatter[]> {
  const resolvedConfig = { ...DEFAULT_CONNECTOR_LOADER_CONFIG, ...config };

  // 检查缓存
  const cacheKey = `connectors:${cwd}`;
  if (resolvedConfig.enableCache) {
    const cached = connectorCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const dirs: string[] = [];

  // 用户全局目录
  if (resolvedConfig.sources.includes('user')) {
    dirs.push(getUserConfigDir('connectors'));
  }

  // 项目级目录
  if (resolvedConfig.sources.includes('project')) {
    dirs.push(getProjectConfigDir(cwd, 'connectors'));
  }

  // 扫描目录
  const connectors: ConnectorFrontmatter[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const absoluteDir = path.resolve(dir);

    try {
      const stat = await fs.stat(absoluteDir).catch(() => null);
      if (!stat?.isDirectory()) {
        continue;
      }

      const files = await fs.readdir(absoluteDir);
      const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of yamlFiles) {
        const filePath = path.join(absoluteDir, file);

        if (seen.has(filePath)) continue;
        seen.add(filePath);

        try {
          const connector = await loadConnectorYaml(filePath);

          // 跳过重复 ID
          if (connectors.some((c) => c.id === connector.id)) {
            continue;
          }

          connectors.push(connector);

          if (connectors.length >= resolvedConfig.maxConnectors) {
            break;
          }
        } catch (error) {
          console.warn(`[ConnectorLoader] Failed to load ${filePath}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      console.debug(`[ConnectorLoader] Scan directory not found: ${absoluteDir}`);
    }
  }

  // 更新缓存
  if (resolvedConfig.enableCache) {
    connectorCache.set(cacheKey, connectors);
  }

  return connectors;
}

/**
 * 清除 Connector 加载缓存
 */
export function clearConnectorCache(): void {
  connectorCache.clear();
}

/**
 * 获取所有可用 Connectors
 */
export async function getAvailableConnectors(
  cwd: string,
): Promise<ConnectorFrontmatter[]> {
  return scanConnectorDirs(cwd);
}

export const CONNECTOR_LOADER_MODULE_VERSION = '1.0.0';