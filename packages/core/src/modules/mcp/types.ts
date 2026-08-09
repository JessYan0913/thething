import { z } from 'zod';

// ============================================================
// MCP Transport Types
// ============================================================

export type McpTransportType = 'sse' | 'http' | 'stdio' | 'streamable-http';

/**
 * OAuth 授权配置（仅 HTTP 类 transport 可用）。
 * 声明后服务器要求标准 OAuth 授权时，registry 会用 OAuthClientProvider 走
 * localhost redirect 授权流程（见 mcp-oauth.ts）。
 */
export interface McpOAuthConfig {
  /** 请求的权限范围；不填则用授权服务器默认（最小化原则建议显式声明） */
  scope?: string;
}

// ============================================================
// MCP Server Config (运行时类型)
// ============================================================

/**
 * MCP 服务器配置
 */
export interface McpServerConfig {
  name: string;
  transport:
    | { type: 'sse'; url: string; headers?: Record<string, string>; oauth?: McpOAuthConfig }
    | { type: 'http'; url: string; headers?: Record<string, string>; oauth?: McpOAuthConfig }
    | { type: 'streamable-http'; url: string; headers?: Record<string, string>; oauth?: McpOAuthConfig }
    | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> };
  enabled?: boolean;
  /** 是否在启动时自动连接，默认 true。设为 false 则注册但不连接，需要时手动启用 */
  autoConnect?: boolean;
  /** 是否阻塞启动直到连接成功，默认 false。仅对 autoConnect 为 true 的服务器有效 */
  alwaysLoad?: boolean;
  /** 连接超时（毫秒），默认 15000（registry DEFAULT_CONNECT_TIMEOUT_MS） */
  connectionTimeout?: number;
  /** 单次工具调用/资源读取超时（毫秒），默认 15000。执行时间长的工具（如浏览器自动化）可调大 */
  requestTimeout?: number;
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
  client: import('@ai-sdk/mcp').MCPClient | null;
  tools: Record<string, unknown>; // ToolSet from ai
  connectedAt: number;
  error?: Error;
  /** 自动重连尝试次数（用于退避计算） */
  reconnectAttempts?: number;
  /** OAuth provider（transport.oauth 已配置时存在），供 startOAuth/completeOAuth 复用 */
  oauth?: import('./mcp-oauth').McpOAuthProviderHandle;
  /** OAuth 授权状态：required=需要授权 / pending=授权进行中 / connected=已授权（有 token） */
  auth?: 'required' | 'pending' | 'connected';
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
    /** OAuth 授权状态（仅 transport.oauth 的服务器）：required/pending/connected */
    auth?: 'required' | 'pending' | 'connected';
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

const OAuthSchema = z.object({
  scope: z.string().optional(),
}).optional();

const SseTransportSchema = z.object({
  type: z.literal('sse'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: OAuthSchema,
});

const HttpTransportSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: OAuthSchema,
});

const StreamableHttpTransportSchema = z.object({
  type: z.literal('streamable-http'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: OAuthSchema,
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
  requestTimeout: z.number().int().positive().optional(),
  tools: ToolsFilterSchema,
  elicitation: ElicitationSchema,
});