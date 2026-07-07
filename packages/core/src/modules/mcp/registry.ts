import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolSet } from 'ai';
import type { McpServerConfig, McpClientConnection, McpRegistrySnapshot } from './types';
import { logger } from '../../primitives/logger';

const execFileAsync = promisify(execFile);

type McpTransport =
  | { type: 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | StdioClientTransport;

// ------------------------------------------------------------------
// 用户 Shell 环境解析（Electron GUI 启动时不加载 .zshenv/.zprofile）
// ------------------------------------------------------------------

/** 缓存：command → 绝对路径 */
const _resolvedCommandCache = new Map<string, string>();
/** 缓存：完整 PATH 字符串 */
let _resolvedFullPath: string | null | undefined; // undefined=未初始化

/**
 * 通过用户登录 shell 解析完整 PATH。
 * Electron 桌面应用的 process.env.PATH 通常只有系统默认值，
 * 不含 nvm / Homebrew / conda 等通过 shell profile 注入的路径。
 */
async function resolveUserPath(): Promise<string | null> {
  if (_resolvedFullPath !== undefined) return _resolvedFullPath;

  const shell = process.env.SHELL || '/bin/zsh';
  const shellName = shell.split('/').pop() ?? 'zsh';
  const currentPath = process.env.PATH || '';

  logger.debug('MCP', `Resolving user PATH via ${shell}`);

  try {
    const { stdout } = await execFileAsync(shell, ['-l', '-c', 'echo "$PATH"'], {
      timeout: 10_000,
      env: process.env as Record<string, string>,
    });

    const resolved = stdout.trim();
    if (resolved && resolved !== currentPath) {
      _resolvedFullPath = resolved;
      logger.debug('MCP', `Resolved user PATH via ${shellName} (${resolved.length} chars)`);
      return resolved;
    }

    logger.debug('MCP', `User PATH same as process PATH, no override needed`);
  } catch (err) {
    logger.error('MCP', `Failed to resolve PATH via ${shellName}: ${err instanceof Error ? err.message : err}`);
  }

  _resolvedFullPath = null;
  return null;
}

/**
 * 解析命令的绝对路径（如 npx → /Users/xxx/.nvm/.../bin/npx）。
 * 优先使用缓存，未缓存时通过用户登录 shell 的 which 命令解析。
 */
async function resolveCommand(command: string): Promise<string> {
  // 已是绝对路径，直接返回
  if (command.startsWith('/')) return command;
  // 已缓存，直接返回
  const cached = _resolvedCommandCache.get(command);
  if (cached) return cached;

  const shell = process.env.SHELL || '/bin/zsh';

  try {
    const { stdout } = await execFileAsync(shell, ['-l', '-c', `which ${command}`], {
      timeout: 5_000,
      env: process.env as Record<string, string>,
    });

    const fullPath = stdout.trim();
    if (fullPath && fullPath.startsWith('/') && !fullPath.includes('not found')) {
      _resolvedCommandCache.set(command, fullPath);
      logger.debug('MCP', `Resolved command '${command}' → ${fullPath}`);
      return fullPath;
    }
  } catch {}

  // 解析失败，返回原始命令名（让 spawn 按系统 PATH 查找）
  logger.debug('MCP', `Could not resolve '${command}', using as-is`);
  return command;
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

    // 1. 合并代理环境变量（@modelcontextprotocol/sdk 默认只继承安全变量，不含代理）
    const proxyVars = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
    const inheritedProxy: Record<string, string> = {};
    for (const key of proxyVars) {
      const val = process.env[key];
      if (val) inheritedProxy[key] = val;
    }

    // 2. 解析命令绝对路径 + 用户完整 PATH（解决 Electron/Web 环境下 PATH 不完整的问题）
    //    通过登录 shell 的 which 解析命令绝对路径，确保 spawn 一定能找到
    const resolvedCommand = await resolveCommand(transport.command);
    const userPath = await resolveUserPath();
    const pathOverride: Record<string, string> = {};
    if (userPath && !transport.env?.PATH) {
      pathOverride.PATH = userPath;
    }

    const finalEnv = {
      ...inheritedProxy,
      ...pathOverride,
      ...transport.env,
    };

    return new StdioClientTransport({
      command: resolvedCommand,
      args: transport.args ?? [],
      env: finalEnv,
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