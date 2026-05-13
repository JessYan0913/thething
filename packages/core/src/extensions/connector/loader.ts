// ============================================================
// Connector Loader - Schema 定义 + 统一加载器代理
// ============================================================
//
// 改造说明：
// - Schema 和类型定义保留在此文件
// - 加载逻辑代理到 loaders/connectors.ts
//

import { z } from 'zod';

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
  executor_config: z.unknown(),
});

const InboundSchema = z.object({
  enabled: z.boolean(),
  webhookPath: z.string().optional(),
  protocol: z.string().min(1),
  transports: z.array(z.string()).optional(),
  reply: z.object({
    tool: z.string(),
    input: z.record(z.string(), z.unknown()).optional().default({}),
  }).optional(),
  processing_indicator: z.object({
    enabled: z.boolean(),
    add_tool: z.string(),
    remove_tool: z.string(),
    add_input: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
});

export const ConnectorFrontmatterSchema = z.object({
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

// ============================================================
// Connector Source (带来源信息) - 保留用于单个文件加载
// ============================================================

export interface ConnectorSource extends ConnectorFrontmatter {
  source: 'user' | 'project';
  filePath: string;
}

// ============================================================
// 代理到 loaders/connectors.ts
// ============================================================

import {
  loadConnectors,
  clearConnectorsCache,
  loadConnectorFile,
} from '../../api/loaders/connectors';

/**
 * 扫描 Connector 配置目录
 *
 * @param cwd 当前工作目录
 * @param config 加载配置
 * @returns Connector 定义列表
 */
export async function scanConnectorDirs(
  cwd?: string,
  config?: Partial<ConnectorLoaderConfig>,
): Promise<ConnectorFrontmatter[]> {
  return loadConnectors({
    cwd,
    sources: config?.sources,
  });
}

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
  return loadConnectorFile(filePath, source);
}

/**
 * 清除 Connector 加载缓存
 */
export function clearConnectorCache(): void {
  clearConnectorsCache();
}

/**
 * 获取所有可用 Connectors
 *
 * @param cwd 当前工作目录
 */
export async function getAvailableConnectors(
  cwd?: string,
): Promise<ConnectorFrontmatter[]> {
  return loadConnectors({ cwd });
}

export const CONNECTOR_LOADER_MODULE_VERSION = '1.0.0';
