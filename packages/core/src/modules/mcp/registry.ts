import { createMCPClient, mcpAppClientCapabilities, type MCPClient, type MCPTransport } from '@ai-sdk/mcp';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolSet } from 'ai';
import { isToolVisibilityAppOnly } from '@modelcontextprotocol/ext-apps/app-bridge';
import { createMcpOAuthProvider, type McpOAuthProviderHandle } from './mcp-oauth';
import type { McpOAuthConfig, McpServerConfig, McpClientConnection, McpRegistrySnapshot } from './types';
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

/** startOAuth 等待 SDK 产生授权 redirect URL 的上限（DCR+metadata+redirect 网络往返） */
const OAUTH_START_TIMEOUT_MS = 15_000;

/**
 * 默认请求超时（毫秒）。
 * stdio 本地服务器响应极快，设一个较短上限，让"连接还在但子进程已死"的
 * 半死管道快速失败并触发重连，而不是干等到 SDK 的 60s 默认超时（-32001）。
 * 慢工具的 server 可用 config.requestTimeout 单独调大。
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * 行为等价比较：剔除 sourcePath 等非行为字段后按 key 排序做稳定序列化。
 * 用于 syncServers 判断某个 server 的配置是否变化。
 */
function configsEqual(a: McpServerConfig, b: McpServerConfig): boolean {
  const stable = (obj: unknown): string =>
    JSON.stringify(obj, function replacer(_key, value) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (value as Record<string, unknown>)[k];
            return acc;
          }, {});
      }
      return value;
    });
  const strip = ({ sourcePath: _s, elicitation: _e, ...rest }: McpServerConfig) => rest;
  return stable(strip(a)) === stable(strip(b));
}

// ------------------------------------------------------------------
// MCP Registry — 管理 MCP 服务器连接和工具
// ------------------------------------------------------------------

/** Registry 构造选项（OAuth 支持需要） */
export interface McpRegistryOptions {
  /** OAuth 状态文件根目录（内部再拼 mcp-auth/）；缺省时 OAuth 配置不生效 */
  oauthDataDir?: string;
  /** OAuth 本地回调地址（localhost redirect 的 redirect_uri） */
  oauthRedirectUrl?: string;
  /** 授权流程要求打开浏览器时回调（前端用它打开授权页） */
  onAuthorizationRequested?: (serverName: string, authorizationUrl: URL) => void;
}

export class McpRegistry {
  private _connections = new Map<string, McpClientConnection>();
  private _servers: McpServerConfig[] = [];
  private _oauthProviders = new Map<string, McpOAuthProviderHandle>();
  private _options: McpRegistryOptions;
  /** startOAuth 捕获的授权 URL（per-server，供 API 层返回给前端打开浏览器） */
  private _lastAuthorizationUrls = new Map<string, string>();

  constructor(servers: McpServerConfig[] = [], options: McpRegistryOptions = {}) {
    this._servers = servers;
    this._options = options;
  }

  get servers(): ReadonlyArray<McpServerConfig> {
    return this._servers;
  }

  get connections(): ReadonlyMap<string, McpClientConnection> {
    return this._connections;
  }

  /**
   * 配置热同步（diff 式）：让 registry 成为运行时唯一状态源。
   * - 移除的 server → 断开连接并从 _servers 删除
   * - 配置变更的 server（含 enabled 切换）→ 断开旧连接，下次 connect 用新配置重建
   * - 新增的 server → 加入 _servers
   * 尾部按需幂等 connectAll（已连且无错误的连接直接复用）。
   *
   * @param configs 磁盘上的最新完整配置列表
   * @param options.connect 默认 true；false 时只应用 diff 不建连接
   *（API 路径用 false + 后台 connectAll，快速返回）
   */
  async syncServers(configs: McpServerConfig[], options?: { connect?: boolean }): Promise<void> {
    const next = new Map(configs.map((c) => [c.name, c]));

    // 1. 移除的 server → 断开
    for (const old of this._servers) {
      if (!next.has(old.name)) {
        await this.disconnect(old.name).catch(() => {});
        logger.debug('MCP', `syncServers: removed ${old.name}`);
      }
    }

    // 2. 配置变更的 server → 断开旧连接（懒重连，下次 connect 用新配置）
    for (const old of this._servers) {
      const updated = next.get(old.name);
      if (!updated) continue;
      if (!configsEqual(old, updated)) {
        await this.disconnect(old.name).catch(() => {});
        logger.debug('MCP', `syncServers: config changed for ${old.name}, connection reset`);
      }
    }

    // 3. 整体替换 server 列表
    this._servers = [...configs];

    // 4. 幂等补连
    if (options?.connect !== false) {
      await this.connectAll();
    }
  }

  async connectAll(): Promise<void> {
    const enabledServers = this._servers.filter((s) => s.enabled !== false);
    if (enabledServers.length === 0) return;
    const totalTimeoutMs = 30_000; // 整体超时 30 秒

    const connectOperation = async (): Promise<void> => {
      // 未授权的 OAuth 服务器跳过自动连接：避免启动时 SDK 遇 401 自动弹出授权页，
      // 授权由用户在设置页点「授权」主动触发（设计文档 D5：不与启动流程耦合）
      const shouldConnect = (s: McpServerConfig): Promise<boolean> => this._shouldAutoConnect(s);

      // 1. Always-load servers — 必须成功，失败则抛出错误
      const alwaysLoadServers: McpServerConfig[] = [];
      for (const server of enabledServers.filter((s) => s.alwaysLoad && s.autoConnect !== false)) {
        if (await shouldConnect(server)) alwaysLoadServers.push(server);
      }
      for (const server of alwaysLoadServers) {
        const conn = await this.connect(server);
        if (conn.error) {
          throw new Error(
            `alwaysLoad MCP server "${server.name}" failed: ${conn.error.message}`,
          );
        }
      }

      // 2. Auto-connect servers — best-effort，不阻塞
      const autoConnectServers: McpServerConfig[] = [];
      for (const server of enabledServers.filter((s) => !s.alwaysLoad && s.autoConnect !== false)) {
        if (await shouldConnect(server)) autoConnectServers.push(server);
      }
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

  /**
   * 是否应自动连接：未授权（无 token）的 OAuth 服务器返回 false。
   * 授权完成后 hasValidTokens 为 true，下次 connectAll 正常连接。
   */
  private async _shouldAutoConnect(server: McpServerConfig): Promise<boolean> {
    if (server.transport.type !== 'stdio' && server.transport.oauth) {
      const provider = this._getOAuthProvider(server.name, server.transport.oauth);
      if (provider && !(await provider.hasValidTokens())) {
        logger.debug('MCP', `OAuth server "${server.name}" 未授权，跳过自动连接`);
        return false;
      }
    }
    return true;
  }

  async connect(config: McpServerConfig, options?: { force?: boolean }): Promise<McpClientConnection> {
    // 1. 已连接且无错误 → 直接返回（force 时跳过复用，强制重连）
    const existing = this._connections.get(config.name);
    if (!options?.force && existing && !existing.error) {
      return existing;
    }

    // force 重连前先关掉旧 client，避免僵尸子进程泄漏
    if (options?.force && existing?.client) {
      await existing.client.close().catch(() => {});
    }

    // 2. 创建新连接（带超时）
    const timeoutMs = config.connectionTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
    try {
      const oauth = this._oauthFor(config);
      const transport = this._createTransport(config);

      // createMCPClient 会 spawn stdio 子进程。withTimeout 只是竞速 reject，
      // 并不会取消底层 promise —— 若超时后它才成功，会留下一个我们已丢弃引用的
      // 孤儿子进程。因此单独持有该 promise，超时路径里兜底 close 掉，杜绝进程泄漏。
      let timedOut = false;
      const clientPromise = createMCPClient({
        transport,
        // 子进程/连接静默死亡时，SDK 通过 onUncaughtError 上报。
        // 将该连接标记为失效，下次 connect() 自动重建（治僵尸连接导致的 -32001）
        onUncaughtError: (error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.warn('MCP', `Connection ${config.name} faulted: ${err.message}`);
          this._invalidate(config.name, err);
        },
        capabilities: {
          // 能力不变式：有 handler 才声明。只 enabled 没 handler 的配置若声明
          // capability，服务器发起 elicitation 会永久挂起等待
          ...(config.elicitation?.enabled && config.elicitation.handler ? { elicitation: {} } : {}),
          ...mcpAppClientCapabilities,
        },
      });
      // 超时后若底层 promise 仍成功，关掉这个没人引用的孤儿 client（杜绝进程泄漏）
      clientPromise.then(
        (orphan) => { if (timedOut) orphan.close().catch(() => {}); },
        () => {},
      );

      const client = await withTimeout(clientPromise, timeoutMs, `MCP connect ${config.name}`)
        .catch((e) => { timedOut = true; throw e; });

      // 注册 elicitation 处理器
      if (config.elicitation?.enabled && config.elicitation.handler) {
        const { ElicitationRequestSchema } = await import('@ai-sdk/mcp');
        client.onElicitationRequest(ElicitationRequestSchema, async (request) => {
          return config.elicitation!.handler!(request.params.message, request.params.requestedSchema);
        });
      }

      // @ai-sdk/mcp ≥2.0.29 的 tools() 返回 McpToolSet（inputSchema: FlexibleSchema<unknown>），
      // 与 ai 的 ToolSet（inputSchema 默认 never）类型不兼容；连接内统一按 ToolSet 对待
      const tools = (await withTimeout(
        client.tools(),
        timeoutMs,
        `MCP tools ${config.name}`
      )) as unknown as ToolSet;
      const filteredTools = this._filterTools(tools, config.tools);

      const connection: McpClientConnection = {
        config,
        client,
        tools: filteredTools,
        connectedAt: Date.now(),
        reconnectAttempts: 0,
        oauth,
        auth: oauth ? 'connected' : undefined,
      };

      this._connections.set(config.name, connection);
      logger.debug('MCP', `Connected to ${config.name} (${Object.keys(filteredTools).length} tools)`);

      return connection;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('MCP', `Failed to connect to ${config.name}: ${err.message}`);

      // 获取之前的重连次数
      const prevAttempts = this._connections.get(config.name)?.reconnectAttempts ?? 0;

      // OAuth 服务器连接失败时，授权状态按"是否已有 token"推断：
      // 已授权（有 token）但连接失败 → auth=connected + error 展示连接错误；
      // 未授权（无 token）→ auth=required，UI 显示「授权」按钮
      const oauth = this._oauthFor(config);
      const auth = oauth ? (await oauth.hasValidTokens() ? 'connected' : 'required') : undefined;

      const errorConnection: McpClientConnection = {
        config,
        client: null,
        tools: {},
        connectedAt: Date.now(),
        error: err,
        reconnectAttempts: prevAttempts + 1,
        oauth,
        auth,
      };

      this._connections.set(config.name, errorConnection);

      return errorConnection;
    }
  }

  /**
   * 将某连接标记为失效（保留 reconnectAttempts 计数），使其在下次 connect() 时重建。
   * 由 onUncaughtError 回调调用，实现僵尸连接自愈。
   */
  private _invalidate(name: string, error: Error): void {
    const conn = this._connections.get(name);
    if (!conn || conn.error) return;
    this._connections.set(name, {
      ...conn,
      client: null,
      error,
      reconnectAttempts: (conn.reconnectAttempts ?? 0) + 1,
    });
  }

  /**
   * 判断某 server 是否配置了 OAuth，并返回其 provider handle（缓存）。
   * 未配置 OAuth / 是 stdio / registry 缺 OAuth options 时返回 undefined。
   */
  private _oauthFor(config: McpServerConfig): McpOAuthProviderHandle | undefined {
    if (config.transport.type === 'stdio') return undefined;
    if (!config.transport.oauth) return undefined;
    return this._getOAuthProvider(config.name, config.transport.oauth);
  }

  private _getOAuthProvider(serverName: string, oauth: McpOAuthConfig): McpOAuthProviderHandle | undefined {
    if (!this._options.oauthDataDir || !this._options.oauthRedirectUrl) {
      logger.warn('MCP', `OAuth configured for "${serverName}" but registry lacks oauthDataDir/oauthRedirectUrl; OAuth 未启用`);
      return undefined;
    }
    let provider = this._oauthProviders.get(serverName);
    if (!provider) {
      provider = createMcpOAuthProvider(serverName, {
        dataDir: this._options.oauthDataDir,
        redirectUrl: this._options.oauthRedirectUrl,
        scope: oauth.scope,
        onAuthorizationRequested: (url) => {
          // 记录本次授权 URL（startOAuth 返回给前端）；同时透传给上层回调
          this._lastAuthorizationUrls.set(serverName, url.toString());
          this._options.onAuthorizationRequested?.(serverName, url);
        },
      });
      this._oauthProviders.set(serverName, provider);
    }
    return provider;
  }

  /**
   * 发起 OAuth 授权：清除 token 后 force 重连，SDK 在首个请求遇 401 时
   * 自动走授权流程 → redirectToAuthorization → onAuthorizationRequested 通知前端打开浏览器。
   * 连接失败（等待用户授权）属预期，由调用方依据 onAuthorizationRequested 继续。
   */
  async startOAuth(name: string): Promise<{ ok: boolean; error?: string; authorizationUrl?: string }> {
    const config = this._servers.find((s) => s.name === name);
    if (!config) return { ok: false, error: `MCP server "${name}" not found` };
    const provider = this._oauthFor(config);
    if (!provider) {
      return { ok: false, error: `MCP server "${name}" 未配置 OAuth（或 registry 未启用 OAuth）` };
    }

    // 并发单飞：已有进行中的授权会话则直接返回，避免重复打开授权页
    const existing = this._connections.get(name);
    if (existing?.auth === 'pending') {
      return { ok: true, authorizationUrl: this._lastAuthorizationUrls.get(name) };
    }

    await provider.resetTokens();

    if (existing) {
      existing.auth = 'pending';
    } else {
      this._connections.set(name, {
        config,
        client: null,
        tools: {},
        connectedAt: Date.now(),
        oauth: provider,
        auth: 'pending',
      });
    }

    // force 重连触发授权；connect 内部会因"等待授权"失败，属预期
    const connResult = await this.connect(config, { force: true }).catch(() => null);
    const conn = this._connections.get(name) ?? connResult;
    if (conn) conn.auth = 'pending';

    // 连接失败说明 SDK 已进入授权流程；redirectToAuthorization 是网络往返
    // （DCR+metadata+redirect），可能晚于 connect 返回——轮询等待授权 URL，
    // 避免返回 authorizationUrl: null 导致前端不弹窗、留下无人认领的 pending。
    // 连接成功（如服务器本就不要求认证）则无需等待。
    if (conn?.error) {
      const deadline = Date.now() + OAUTH_START_TIMEOUT_MS;
      while (!this._lastAuthorizationUrls.has(name) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return { ok: true, authorizationUrl: this._lastAuthorizationUrls.get(name) };
  }

  /**
   * 完成 OAuth 授权：用 authorizationCode 交换 token（SDK auth()），成功后 force 重连。
   * 由本地回调 route（/api/mcp/oauth/callback）调用。
   */
  async completeOAuth(name: string, authorizationCode: string, callbackState: string): Promise<{ ok: boolean; error?: string }> {
    const config = this._servers.find((s) => s.name === name);
    if (!config) return { ok: false, error: `MCP server "${name}" not found` };
    if (config.transport.type === 'stdio' || !config.transport.oauth) {
      return { ok: false, error: `MCP server "${name}" 未配置 OAuth` };
    }
    const provider = this._getOAuthProvider(name, config.transport.oauth);
    if (!provider) return { ok: false, error: 'registry 未启用 OAuth' };

    try {
      await provider.completeAuthorization(config.transport.url, authorizationCode, callbackState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('MCP', `OAuth complete failed for ${name}: ${message}`);
      return { ok: false, error: message };
    }

    const conn = await this.connect(config, { force: true });
    if (conn.error) return { ok: false, error: conn.error.message };
    return { ok: true };
  }

  /** 是否已授权（有 token）。供 UI 判断是否需要显示授权按钮。 */
  async hasOAuthAuth(name: string): Promise<boolean> {
    const config = this._servers.find((s) => s.name === name);
    if (!config) return false;
    const provider = this._oauthFor(config);
    if (!provider) return false;
    return provider.hasValidTokens();
  }

  /**
   * 登出 / 重新授权：清除 token 并断开连接，状态回到 auth=required。
   * 供 DELETE /api/mcp/oauth 与 UI「重新授权」入口调用。
   */
  async resetOAuth(name: string): Promise<{ ok: boolean; error?: string }> {
    const config = this._servers.find((s) => s.name === name);
    if (!config) return { ok: false, error: `MCP server "${name}" not found` };
    const provider = this._oauthFor(config);
    if (!provider) return { ok: false, error: `MCP server "${name}" 未配置 OAuth` };
    await provider.resetTokens();
    this._lastAuthorizationUrls.delete(name);
    await this.disconnect(name).catch(() => {});
    logger.debug('MCP', `OAuth: reset (logout) for ${name}`);
    return { ok: true };
  }

  /**
   * 确保 server 有一个健康连接：没有连接或已失效则（重）连一次。
   * 返回可用的 client，失败则抛出连接错误。
   */
  private async _ensureClient(name: string, force = false): Promise<MCPClient> {
    const config = this._servers.find((s) => s.name === name);
    if (!config) throw new Error(`MCP server "${name}" not found`);

    let conn = this._connections.get(name);
    if (force || !conn || conn.error || !conn.client) {
      conn = await this.connect(config, { force });
    }
    if (conn.error || !conn.client) {
      throw conn.error ?? new Error(`MCP server "${name}" not connected`);
    }
    return conn.client as MCPClient;
  }

  /**
   * 读取资源，带请求超时 + 一次自动重连重试。
   * 首次因半死连接超时/报错时，强制重连再试一次，仍失败才抛出。
   */
  async readResourceSafe(name: string, uri: string) {
    const client = await this._ensureClient(name);
    const timeout = this._servers.find((s) => s.name === name)?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
    try {
      return await client.readResource({ uri, options: { timeout } });
    } catch (error) {
      logger.warn('MCP', `readResource ${name} failed, reconnecting: ${error instanceof Error ? error.message : error}`);
      const retryClient = await this._ensureClient(name, true);
      return retryClient.readResource({ uri, options: { timeout } });
    }
  }

  /**
   * 调用工具，带请求超时 + 一次自动重连重试。
   */
  async callToolSafe(name: string, toolName: string, args: Record<string, unknown>) {
    const client = await this._ensureClient(name);
    const timeout = this._servers.find((s) => s.name === name)?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
    try {
      return await client.callTool({ name: toolName, arguments: args, options: { timeout } });
    } catch (error) {
      logger.warn('MCP', `callTool ${name}/${toolName} failed, reconnecting: ${error instanceof Error ? error.message : error}`);
      const retryClient = await this._ensureClient(name, true);
      return retryClient.callTool({ name: toolName, arguments: args, options: { timeout } });
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

  // 技术债修复（appVisible 接线缺口）：visibility 仅作模型可见性控制字段。
  // 删除冗余的双路分类——app-only 工具是"只给 App 用、不给模型"，而 App 侧
  // （proxy/tools-list）根本不消费 app-only 语义，自己用 isToolVisibilityModelOnly
  // 过滤。这里只保留"排除 app-only 工具出模型"这一核心语义，与 getServerTools
  // 口径统一（后者原样返回，由调用方视场景过滤）。
  getAllTools(): ToolSet {
    const tools: ToolSet = {};
    for (const [, conn] of this._connections) {
      for (const [name, tool] of Object.entries(conn.tools as ToolSet)) {
        if (isToolVisibilityAppOnly(tool as Record<string, unknown>)) continue;
        tools[name] = tool;
      }
    }
    return tools;
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
      // OAuth 服务器：未连接时按连接记录推断（无记录=未授权过→required）
      const oauthConfigured = s.transport.type !== 'stdio' && !!s.transport.oauth;
      const auth = oauthConfigured ? (conn?.auth ?? 'required') : undefined;
      return {
        name: s.name,
        enabled: s.enabled !== false,
        connected: !!conn && !conn.error,
        toolCount: tools.length,
        tools,
        error: conn?.error?.message,
        auth,
      };
    });

    return {
      servers,
      totalTools: servers.reduce((sum, s) => sum + s.toolCount, 0),
    };
  }

  private _createTransport(config: McpServerConfig): MCPTransport | { type: 'sse' | 'http'; url: string; headers?: Record<string, string>; authProvider?: McpOAuthProviderHandle } {
    const transport = config.transport;
    if (transport.type === 'stdio') {
      // PATH 解析已在 loader 阶段完成，这里直接使用
      // 注入代理环境变量
      const proxyVars = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
      const inheritedProxy: Record<string, string> = {};
      for (const key of proxyVars) {
        const val = process.env[key];
        if (val) inheritedProxy[key] = val;
      }

      return new StdioClientTransport({
        command: transport.command,  // 已是绝对路径
        args: transport.args ?? [],
        env: { ...inheritedProxy, ...transport.env },
      });
    }
    // OAuth 服务器：向 transport 注入 authProvider，SDK 在遇 401 时自动走授权流程
    const provider = this._oauthFor(config);
    const authField = provider ? { authProvider: provider } : {};
    // SSE/HTTP/Streamable-HTTP 直接返回配置对象
    // 注意: @ai-sdk/mcp 只支持 sse 和 http，streamable-http 需要特殊处理
    if (transport.type === 'streamable-http') {
      // 将 streamable-http 转换为 http 配置
      return { type: 'http', url: transport.url, headers: transport.headers, ...authField };
    }
    return { ...transport, ...authField };
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

export function createMcpRegistry(servers: McpServerConfig[] = [], options: McpRegistryOptions = {}): McpRegistry {
  return new McpRegistry(servers, options);
}
