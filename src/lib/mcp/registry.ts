import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';

export type McpTransportType = 'sse' | 'http' | 'stdio';

export interface McpServerConfig {
  name: string;
  transport:
    | { type: 'sse'; url: string; headers?: Record<string, string> }
    | { type: 'http'; url: string; headers?: Record<string, string> }
    | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> };
  enabled?: boolean;
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
}

export interface McpClientConnection {
  config: McpServerConfig;
  client: MCPClient | null;
  tools: ToolSet;
  connectedAt: number;
  error?: Error;
}

export interface McpRegistrySnapshot {
  servers: Array<{
    name: string;
    enabled: boolean;
    connected: boolean;
    toolCount: number;
    error?: string;
  }>;
  totalTools: number;
}

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
    for (const server of enabledServers) {
      await this.connect(server);
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

      const client = await createMCPClient({
        transport: transport as any,
        capabilities: config.elicitation?.enabled ? { elicitation: {} } : undefined,
      });

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
      console.log(`[MCP] Connected to ${config.name} (${Object.keys(filteredTools).length} tools)`);

      return connection;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[MCP] Failed to connect to ${config.name}:`, err.message);

      this._connections.set(config.name, {
        config,
        client: null,
        tools: {},
        connectedAt: Date.now(),
        error: err,
      });

      throw error;
    }
  }

  async disconnect(name: string): Promise<void> {
    const connection = this._connections.get(name);
    if (!connection) return;

    if (connection.client) {
      try {
        await connection.client.close();
      } catch {}
    }

    this._connections.delete(name);
    console.log(`[MCP] Disconnected from ${name}`);
  }

  async disconnectAll(): Promise<void> {
    const names = Array.from(this._connections.keys());
    await Promise.allSettled(names.map((name) => this.disconnect(name)));
  }

  getAllTools(): ToolSet {
    let merged: ToolSet = {};
    for (const [, conn] of this._connections) {
      merged = { ...merged, ...conn.tools };
    }
    return merged;
  }

  getServerTools(name: string): ToolSet {
    return this._connections.get(name)?.tools ?? {};
  }

  snapshot(): McpRegistrySnapshot {
    const servers = this._servers.map((s) => {
      const conn = this._connections.get(s.name);
      return {
        name: s.name,
        enabled: s.enabled !== false,
        connected: !!conn && !conn.error,
        toolCount: conn ? Object.keys(conn.tools).length : 0,
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
  }): Promise<unknown> {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    return new StdioClientTransport({
      command: transport.command,
      args: transport.args ?? [],
      env: transport.env,
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