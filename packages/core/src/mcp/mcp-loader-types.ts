import { z } from 'zod';
import type { McpServerConfig } from './registry';

// ============================================================
// MCP Server Config Schema
// ============================================================

/**
 * Stdio Transport Schema
 */
const StdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

/**
 * SSE Transport Schema
 */
const SseTransportSchema = z.object({
  type: z.literal('sse'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

/**
 * HTTP Transport Schema
 */
const HttpTransportSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

/**
 * Transport Schema (union of all transport types)
 */
const TransportSchema = z.union([StdioTransportSchema, SseTransportSchema, HttpTransportSchema]);

/**
 * Tools Filter Schema
 */
const ToolsFilterSchema = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
}).optional();

/**
 * Elicitation Handler Schema
 */
const ElicitationSchema = z.object({
  enabled: z.boolean(),
}).optional();

/**
 * MCP Server Config Schema for JSON file validation
 */
export const McpServerConfigSchema = z.object({
  name: z.string().min(1),
  transport: TransportSchema,
  enabled: z.boolean().default(true),
  tools: ToolsFilterSchema,
  elicitation: ElicitationSchema,
});

// ============================================================
// MCP Loader Config
// ============================================================

export interface McpLoaderConfig {
  /** 扫描目录来源 */
  sources?: ('user' | 'project')[];
  /** 最大 MCP 服务器数量 */
  maxServers?: number;
  /** 是否启用缓存 */
  enableCache?: boolean;
}

const DEFAULT_MCP_LOADER_CONFIG: McpLoaderConfig = {
  sources: ['user', 'project'],
  maxServers: 50,
  enableCache: true,
};

// ============================================================
// Export Types
// ============================================================

/**
 * MCP 服务器配置（带来源信息）
 */
export interface McpServerConfigSource extends McpServerConfig {
  /** 配置来源 */
  source: 'user' | 'project';
  /** 配置文件路径 */
  filePath: string;
}

export { DEFAULT_MCP_LOADER_CONFIG };