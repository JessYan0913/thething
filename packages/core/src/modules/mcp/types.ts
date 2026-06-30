import { z } from 'zod';

// ============================================================
// MCP Transport Types
// ============================================================

export type McpTransportType = 'sse' | 'http' | 'stdio' | 'streamable-http';

// ============================================================
// MCP Server Config (运行时类型)
// ============================================================

/**
 * MCP 服务器配置
 */
export interface McpServerConfig {
  name: string;
  transport:
    | { type: 'sse'; url: string; headers?: Record<string, string> }
    | { type: 'http'; url: string; headers?: Record<string, string> }
    | { type: 'streamable-http'; url: string; headers?: Record<string, string> }
    | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> };
  enabled?: boolean;
  /** 是否在启动时自动连接，默认 true。设为 false 则注册但不连接，需要时手动启用 */
  autoConnect?: boolean;
  /** 是否阻塞启动直到连接成功，默认 false。仅对 autoConnect 为 true 的服务器有效 */
  alwaysLoad?: boolean;
  /** 连接超时（毫秒），默认 10000。0 表示不超时 */
  connectionTimeout?: number;
  tools?: {
    include?: string[];
    exclude?: string[];
  };
  elicitation?: {
    enabled: boolean;
    handler?: (
      message: string,
      schema: unknown,
    ) => Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }>;
  };
  /** 加载来源文件路径（由 loader 设置） */
  sourcePath?: string;
}

/**
 * MCP 服务器配置（带来源信息）
 */
export interface McpServerConfigSource extends McpServerConfig {
  source: 'user' | 'project';
  filePath: string;
}

// ============================================================
// MCP Client Connection
// ============================================================

export interface McpClientConnection {
  config: McpServerConfig;
  client: unknown; // MCPClient from @ai-sdk/mcp
  tools: Record<string, unknown>; // ToolSet from ai
  connectedAt: number;
  error?: Error;
}

export interface ToolInfo {
  name: string;
  description?: string;
}

export interface McpRegistrySnapshot {
  servers: Array<{
    name: string;
    enabled: boolean;
    connected: boolean;
    toolCount: number;
    tools: ToolInfo[];
    error?: string;
  }>;
  totalTools: number;
}

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

export const DEFAULT_MCP_LOADER_CONFIG: McpLoaderConfig = {
  sources: ['user', 'project'],
  maxServers: 50,
  enableCache: true,
};

// ============================================================
// MCP Server Config Schema (用于 JSON 文件验证)
// ============================================================

const StdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const SseTransportSchema = z.object({
  type: z.literal('sse'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

const HttpTransportSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

const StreamableHttpTransportSchema = z.object({
  type: z.literal('streamable-http'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

const TransportSchema = z.union([
  StdioTransportSchema,
  SseTransportSchema,
  HttpTransportSchema,
  StreamableHttpTransportSchema,
]);

const ToolsFilterSchema = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
}).optional();

const ElicitationSchema = z.object({
  enabled: z.boolean(),
}).optional();

export const McpServerConfigSchema = z.object({
  name: z.string().min(1),
  transport: TransportSchema,
  enabled: z.boolean().default(true),
  autoConnect: z.boolean().optional(),
  alwaysLoad: z.boolean().optional(),
  connectionTimeout: z.number().int().positive().optional(),
  tools: ToolsFilterSchema,
  elicitation: ElicitationSchema,
});