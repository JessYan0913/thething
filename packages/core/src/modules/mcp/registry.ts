import { createMCPClient, mcpAppClientCapabilities, type MCPClient, type MCPTransport } from '@ai-sdk/mcp';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolSet } from 'ai';
import type { McpServerConfig, McpClientConnection, McpRegistrySnapshot } from './types';
import { logger } from '../../primitives/logger';

// ============================================================
// 超时工具
// ============================================================

/** 带超时的 Promise */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/** 默认连接超时（毫秒） */
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

// ------------------------------------------------------------------
// MCP Registry — 管理 MCP 服务器连接和工具
// ------------------------------------------------------------------

export class McpRegistry {
  private _connections = new Map<string, McpClientConnection>();
  private _servers: McpServerConfig[] = [];

  constructor(servers: McpServerConfig[] = []) {
    this._servers = servers;
  }

  get servers(): ReadonlyArray<McpServerConfig> {
    return this._servers;
  }

  get connections(): ReadonlyMap<string, McpClientConnection> {
    return this._connections;
  }

  async connectAll(): Promise<void> {
    const enabledServers = this._servers.filter((s) => s.enabled !== false);
    const totalTimeoutMs = 30_000; // 整体超时 30 秒

    const connectOperation = async (): Promise<void> => {
      // 1. Always-load servers — 必须成功，失败则抛出错误
      const alwaysLoadServers = enabledServers.filter(
        (s) => s.alwaysLoad && s.autoConnect !== false,
      );
      for (const server of alwaysLoadServers) {
        const conn = await this.connect(server);
        if (conn.error) {
          throw new Error(
            `alwaysLoad MCP server "${server.name}" failed: ${conn.error.message}`,
          );
        }
      }

      // 2. Auto-connect servers — best-effort，不阻塞
      const autoConnectServers = enabledServers.filter(
        (s) => !s.alwaysLoad && s.autoConnect !== false,
      );
      if (autoConnectServers.length > 0) {
        // 并行连接所有服务器，每个服务器有独立超时
        const results = await Promise.allSettled(
          autoConnectServers.map((server) => this.connect(server)),
        );
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          logger.warn('MCP', `${failed.length}/${autoConnectServers.length} server(s) failed to connect`);
        }
      }
    };

    try {
      await withTimeout(connectOperation(), totalTimeoutMs, 'MCP connectAll');
    } catch (error) {
      logger.error('MCP', `connectAll failed: ${error}`);
      // 不抛出错误，让调用方继续执行（best-effort）
    }
  }

  async connect(config: McpServerConfig): Promise<McpClientConnection> {
    // 1. 已连接且无错误 → 直接返回
    const existing = this._connections.get(config.name);
    if (existing && !existing.error) {
      return existing;
    }

    // 2. 创建新连接（带超时）
    const timeoutMs = config.connectionTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
    try {
      const transport = this._createTransport(config.transport);

      const client = await withTimeout(
        createMCPClient({
          transport,
          capabilities: {
            ...(config.elicitation?.enabled ? { elicitation: {} } : {}),
            ...mcpAppClientCapabilities,
          },
        }),
        timeoutMs,
        `MCP connect ${config.name}`
      );

      // 注册 elicitation 处理器
      if (config.elicitation?.enabled && config.elicitation.handler) {
        const { ElicitationRequestSchema } = await import('@ai-sdk/mcp');
        client.onElicitationRequest(ElicitationRequestSchema, async (request) => {
          return config.elicitation!.handler!(request.params.message, request.params.requestedSchema);
        });
      }

      const tools = await withTimeout(
        client.tools(),
        timeoutMs,
        `MCP tools ${config.name}`
      );
      const filteredTools = this._filterTools(tools, config.tools);

      const connection: McpClientConnection = {
        config,
        client,
        tools: filteredTools,
        connectedAt: Date.now(),
        reconnectAttempts: 0,
      };

      this._connections.set(config.name, connection);
      logger.debug('MCP', `Connected to ${config.name} (${Object.keys(filteredTools).length} tools)`);

      return connection;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('MCP', `Failed to connect to ${config.name}: ${err.message}`);

      // 获取之前的重连次数
      const prevAttempts = this._connections.get(config.name)?.reconnectAttempts ?? 0;

      const errorConnection: McpClientConnection = {
        config,
        client: null,
        tools: {},
        connectedAt: Date.now(),
        error: err,
        reconnectAttempts: prevAttempts + 1,
      };

      this._connections.set(config.name, errorConnection);

      return errorConnection;
    }
  }

  async disconnect(name: string): Promise<void> {
    const connection = this._connections.get(name);
    if (!connection) return;

    if (connection.client) {
      try {
        await (connection.client as MCPClient).close();
      } catch (e) {
        logger.warn('MCP', `Error closing ${name}: ${e instanceof Error ? e.message : e}`);
      }
    }

    this._connections.delete(name);
    logger.debug('MCP', `Disconnected from ${name}`);
  }

  async disconnectAll(): Promise<void> {
    const names = Array.from(this._connections.keys());
    await Promise.allSettled(names.map((name) => this.disconnect(name)));
  }

  getAllTools(): ToolSet {
    const { modelVisible } = this.getAllToolsWithAppVisibility();
    return modelVisible;
  }

  getAllToolsWithAppVisibility(): { modelVisible: ToolSet; appVisible: ToolSet } {
    let modelVisible: ToolSet = {};
    let appVisible: ToolSet = {};

    for (const [, conn] of this._connections) {
      for (const [name, tool] of Object.entries(conn.tools as ToolSet)) {
        const visibility = (tool as { _meta?: { ui?: { visibility?: string[] } } })?._meta?.ui?.visibility;
        const isAppOnly = Array.isArray(visibility)
          && visibility.includes('app')
          && !visibility.includes('model');
        if (isAppOnly) {
          appVisible[name] = tool;
        } else {
          modelVisible[name] = tool;
        }
      }
    }

    return { modelVisible, appVisible };
  }

  getServerTools(name: string): ToolSet {
    return (this._connections.get(name)?.tools as ToolSet) ?? {};
  }

  snapshot(): McpRegistrySnapshot {
    const servers = this._servers.map((s) => {
      const conn = this._connections.get(s.name);
      const tools = conn
        ? Object.entries(conn.tools).map(([name, tool]) => ({
            name,
            description: (tool as { description?: string }).description,
          }))
        : [];
      return {
        name: s.name,
        enabled: s.enabled !== false,
        connected: !!conn && !conn.error,
        toolCount: tools.length,
        tools,
        error: conn?.error?.message,
      };
    });

    return {
      servers,
      totalTools: servers.reduce((sum, s) => sum + s.toolCount, 0),
    };
  }

  private _createTransport(config: McpServerConfig['transport']): MCPTransport | { type: 'sse' | 'http'; url: string; headers?: Record<string, string> } {
    if (config.type === 'stdio') {
      // PATH 解析已在 loader 阶段完成，这里直接使用
      // 注入代理环境变量
      const proxyVars = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
      const inheritedProxy: Record<string, string> = {};
      for (const key of proxyVars) {
        const val = process.env[key];
        if (val) inheritedProxy[key] = val;
      }

      return new StdioClientTransport({
        command: config.command,  // 已是绝对路径
        args: config.args ?? [],
        env: { ...inheritedProxy, ...config.env },
      });
    }
    // SSE/HTTP/Streamable-HTTP 直接返回配置对象
    // 注意: @ai-sdk/mcp 只支持 sse 和 http，streamable-http 需要特殊处理
    if (config.type === 'streamable-http') {
      // 将 streamable-http 转换为 http 配置
      return { type: 'http', url: config.url, headers: config.headers };
    }
    return config;
  }

  private _filterTools(tools: ToolSet, filter?: { include?: string[]; exclude?: string[] }): ToolSet {
    if (!filter || (!filter.include?.length && !filter.exclude?.length)) {
      return tools;
    }

    const result: ToolSet = {};
    for (const [name, tool] of Object.entries(tools)) {
      const included = !filter.include?.length || filter.include.includes(name);
      const excluded = filter.exclude?.length && filter.exclude.includes(name);

      if (included && !excluded) {
        result[name] = tool;
      }
    }

    return result;
  }
}

export function createMcpRegistry(servers: McpServerConfig[] = []): McpRegistry {
  return new McpRegistry(servers);
}
