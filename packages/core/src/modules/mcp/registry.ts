import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolSet } from 'ai';
import type { McpServerConfig, McpClientConnection, McpRegistrySnapshot } from './types';
import { logger } from '../../primitives/logger';

type McpTransport =
  | { type: 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | StdioClientTransport;

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

    // 1. Always-load servers — 阻塞直到连接成功（受超时保护）
    const alwaysLoadServers = enabledServers.filter(
      (s) => s.alwaysLoad && s.autoConnect !== false,
    );
    if (alwaysLoadServers.length > 0) {
      const results = await Promise.allSettled(
        alwaysLoadServers.map((server) => this.connect(server)),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        logger.warn('MCP', `${failed.length}/${alwaysLoadServers.length} alwaysLoad server(s) failed to connect`);
      }
    }

    // 2. Auto-connect 服务器 — 后台异步，不阻塞
    const autoConnectServers = enabledServers.filter(
      (s) => !s.alwaysLoad && s.autoConnect !== false,
    );
    if (autoConnectServers.length > 0) {
      Promise.allSettled(
        autoConnectServers.map((server) => this.connect(server)),
      ).then((results) => {
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          logger.warn('MCP', `${failed.length}/${autoConnectServers.length} server(s) failed to connect`);
        }
      });
    }
  }

  async connect(config: McpServerConfig): Promise<McpClientConnection> {
    if (this._connections.has(config.name)) {
      return this._connections.get(config.name)!;
    }

    try {
      const transport =
        config.transport.type === 'stdio'
          ? await this._createStdioTransport(config.transport)
          : (config.transport as { type: 'sse' | 'http'; url: string; headers?: Record<string, string> });

      // 应用连接超时（默认 10s，设为 0 则不超时）
      const timeoutMs = config.connectionTimeout ?? 10_000;
      let client: MCPClient;
      if (timeoutMs > 0) {
        client = await Promise.race([
          createMCPClient({
            transport: transport as McpTransport,
            capabilities: config.elicitation?.enabled ? { elicitation: {} } : undefined,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs}ms`)), timeoutMs),
          ),
        ]);
      } else {
        client = await createMCPClient({
          transport: transport as McpTransport,
          capabilities: config.elicitation?.enabled ? { elicitation: {} } : undefined,
        });
      }

      if (config.elicitation?.enabled && config.elicitation.handler) {
        const { ElicitationRequestSchema } = await import('@ai-sdk/mcp');

        client.onElicitationRequest(ElicitationRequestSchema, async (request) => {
          const userInput = await config.elicitation!.handler!(request.params.message, request.params.requestedSchema);
          return userInput;
        });
      }

      const tools = await client.tools();
      const filteredTools = this._filterTools(tools, config.tools);

      const connection: McpClientConnection = {
        config,
        client,
        tools: filteredTools,
        connectedAt: Date.now(),
      };

      this._connections.set(config.name, connection);
      logger.debug('MCP', `Connected to ${config.name} (${Object.keys(filteredTools).length} tools)`);

      return connection;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('MCP', `Failed to connect to ${config.name}: ${err.message}`);

      const errorConnection: McpClientConnection = {
        config,
        client: null,
        tools: {},
        connectedAt: Date.now(),
        error: err,
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
      } catch {}
    }

    this._connections.delete(name);
    logger.debug('MCP', `Disconnected from ${name}`);
  }

  async disconnectAll(): Promise<void> {
    const names = Array.from(this._connections.keys());
    await Promise.allSettled(names.map((name) => this.disconnect(name)));
  }

  getAllTools(): ToolSet {
    let merged: ToolSet = {};
    for (const [, conn] of this._connections) {
      merged = { ...merged, ...conn.tools as ToolSet };
    }
    return merged;
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

  private async _createStdioTransport(transport: {
    type: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }): Promise<StdioClientTransport> {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

    // 合并代理环境变量（@modelcontextprotocol/sdk 默认只继承安全变量，不含代理）
    const proxyVars = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
    const inheritedProxy: Record<string, string> = {};
    for (const key of proxyVars) {
      const val = process.env[key];
      if (val) inheritedProxy[key] = val;
    }

    return new StdioClientTransport({
      command: transport.command,
      args: transport.args ?? [],
      env: {
        ...inheritedProxy,
        ...transport.env,
      },
    });
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