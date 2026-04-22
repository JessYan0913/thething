import { z } from 'zod';
import {
  parsePlainYamlFile,
  scanConfigDirs,
  getUserConfigDir,
  getProjectConfigDir,
  mergeByPriority,
  LoadingCache,
} from '../loading';

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
// Connector Loader Config
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

// ============================================================
// Connector Source (带来源信息)
// ============================================================

export interface ConnectorSource extends ConnectorFrontmatter {
  source: 'user' | 'project';
  filePath: string;
}

// ============================================================
// Connector 加载
// ============================================================

/**
 * 从 YAML 文件加载 Connector 定义
 *
 * @param filePath YAML 文件路径
 * @param source 来源标识
 * @returns Connector 定义（带来源信息）
 */
export async function loadConnectorYaml(
  filePath: string,
  source: 'user' | 'project',
): Promise<ConnectorSource> {
  const result = await parsePlainYamlFile(filePath, ConnectorFrontmatterSchema);

  // 替换环境变量
  const processed = replaceEnvVars(result.data as Record<string, unknown>);

  // 再次验证（环境变量替换后）
  const validated = ConnectorFrontmatterSchema.safeParse(processed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid connector config after env replacement: ${issues}`);
  }

  return {
    ...validated.data,
    source,
    filePath: result.filePath,
  };
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
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 * @param config 加载配置
 * @returns Connector 定义列表
 */
export async function scanConnectorDirs(
  cwd?: string,
  config?: Partial<ConnectorLoaderConfig>,
): Promise<ConnectorFrontmatter[]> {
  const effectiveCwd = cwd ?? process.cwd();
  const resolvedConfig = { ...DEFAULT_CONNECTOR_LOADER_CONFIG, ...config };

  // 检查缓存
  const cacheKey = `connectors:${effectiveCwd}`;
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
    dirs.push(getProjectConfigDir(effectiveCwd, 'connectors'));
  }

  // 使用 scanConfigDirs 扫描
  const scanResults = await scanConfigDirs(effectiveCwd, {
    dirs,
    filePattern: '*.yaml',
    recursive: false,
  });

  // 也扫描 .yml 文件
  const ymlScanResults = await scanConfigDirs(effectiveCwd, {
    dirs,
    filePattern: '*.yml',
    recursive: false,
  });

  const allResults = [...scanResults, ...ymlScanResults];
  const connectors: ConnectorSource[] = [];
  const seenPaths = new Set<string>();

  // 加载每个文件
  for (const result of allResults) {
    if (seenPaths.has(result.filePath)) continue;
    seenPaths.add(result.filePath);

    try {
      const connector = await loadConnectorYaml(
        result.filePath,
        result.source as 'user' | 'project',
      );
      connectors.push(connector);

      if (connectors.length >= resolvedConfig.maxConnectors) {
        break;
      }
    } catch (error) {
      console.warn(`[ConnectorLoader] Failed to load ${result.filePath}: ${(error as Error).message}`);
    }
  }

  // 按优先级合并（project > user）
  const merged = mergeByPriority(
    connectors,
    ['project', 'user'],
    (c) => c.id,
  );

  // 去除来源元数据
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
  if (resolvedConfig.enableCache) {
    connectorCache.set(cacheKey, result);
  }

  return result;
}

/**
 * 清除 Connector 加载缓存
 */
export function clearConnectorCache(): void {
  connectorCache.clear();
}

/**
 * 获取所有可用 Connectors
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 */
export async function getAvailableConnectors(
  cwd?: string,
): Promise<ConnectorFrontmatter[]> {
  return scanConnectorDirs(cwd);
}

export const CONNECTOR_LOADER_MODULE_VERSION = '1.0.0';