import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpRegistry } from '../registry';
import { parseOAuthState } from '../mcp-oauth';

// ============================================================
// Mock MCP OAuth Server
// ============================================================
// 起一个真实的本地 OAuth MCP 服务器，驱动 @ai-sdk/mcp 的完整授权链路：
//   MCP 请求 401（WWW-Authenticate: Bearer resource_metadata）→
//   OAuth protected resource / authorization server metadata 发现 →
//   DCR（register）→ authorize（302 回 redirect_uri，追加 code+state）→
//   token exchange（验 code_verifier）→ 带 Bearer 重试 MCP 请求。
//
// 本测试文件【不 mock @ai-sdk/mcp】：验证 startOAuth → 授权 URL →
// state 还原服务器名 → completeOAuth → 连接 的真实链路（设计 §7.2 的承诺）。

interface MockOAuthServer {
  baseUrl: string;
  registeredClients: Array<Record<string, unknown>>;
  lastTokenRequest?: { code?: string; codeVerifier?: string; clientId?: string };
  close(): Promise<void>;
}

async function startMockOAuthServer(): Promise<MockOAuthServer> {
  const registeredClients: Array<Record<string, unknown>> = [];
  let lastTokenRequest: MockOAuthServer['lastTokenRequest'] = undefined;
  let baseUrl = '';

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    const json = (code: number, data: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const readBody = (): Promise<string> =>
      new Promise((resolve) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => resolve(body));
      });

    // MCP endpoint：无 Bearer → 401（触发 OAuth 流程）；有 Bearer → JSON-RPC
    if (path === '/mcp' && method === 'POST') {
      const auth = req.headers.authorization ?? '';
      if (!auth.startsWith('Bearer ')) {
        res.writeHead(401, {
          'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
        });
        res.end();
        return;
      }
      void readBody().then((body) => {
        const msg = JSON.parse(body) as { method?: string; id?: number };
        if (msg.method === 'initialize') {
          json(200, {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2025-11-25',
              // tools 能力声明：SDK assertCapability 检查 serverCapabilities.tools
              capabilities: { tools: {} },
              serverInfo: { name: 'mock', version: '1.0.0' },
            },
          });
        } else if (msg.method === 'tools/list') {
          json(200, {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              tools: [
                {
                  name: 'echo',
                  description: 'Echo the input',
                  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
                },
              ],
            },
          });
        } else {
          json(200, { jsonrpc: '2.0', id: msg.id, result: {} });
        }
      });
      return;
    }

    // OAuth protected resource metadata
    if (path === '/.well-known/oauth-protected-resource') {
      json(200, { resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl] });
      return;
    }

    // authorization server metadata（字段对齐 @ai-sdk/mcp 2.0.29 OAuthMetadataSchema）
    if (path === '/.well-known/oauth-authorization-server') {
      json(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        registration_endpoint: `${baseUrl}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
      return;
    }

    // DCR
    if (path === '/register' && method === 'POST') {
      void readBody().then((body) => {
        const metadata = JSON.parse(body) as Record<string, unknown>;
        registeredClients.push(metadata);
        json(201, {
          client_id: 'mock-client-id',
          redirect_uris: metadata.redirect_uris,
          token_endpoint_auth_method: 'none',
        });
      });
      return;
    }

    // authorize：模拟浏览器——302 回 redirect_uri，追加 code + state
    if (path === '/authorize' && method === 'GET') {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const cb = new URL(redirectUri);
      cb.searchParams.set('code', 'mock-code-42');
      cb.searchParams.set('state', state);
      res.writeHead(302, { Location: cb.toString() });
      res.end();
      return;
    }

    // token exchange（form-urlencoded，对齐 SDK exchangeAuthorization）
    if (path === '/token' && method === 'POST') {
      void readBody().then((body) => {
        const params = new URLSearchParams(body);
        lastTokenRequest = {
          code: params.get('code') ?? undefined,
          codeVerifier: params.get('code_verifier') ?? undefined,
          clientId: params.get('client_id') ?? undefined,
        };
        const grantType = params.get('grant_type');
        if (grantType === 'refresh_token') {
          json(200, { access_token: 'mock-at-refreshed', token_type: 'Bearer', expires_in: 3600, refresh_token: 'mock-rt', scope: 'test' });
        } else {
          json(200, { access_token: 'mock-access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'mock-rt', scope: 'test' });
        }
      });
      return;
    }

    json(404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    registeredClients,
    get lastTokenRequest() {
      return lastTokenRequest;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ============================================================
// 测试
// ============================================================

describe('MCP OAuth 真实链路（mock server，不 mock SDK）', () => {
  let mock: MockOAuthServer;
  let dataDir: string;
  let registry: McpRegistry;
  const serverName = 'github';

  const config = () => ({
    name: serverName,
    transport: { type: 'http' as const, url: `${mock.baseUrl}/mcp`, oauth: { scope: 'test' } },
    enabled: true,
  });

  beforeAll(async () => {
    mock = await startMockOAuthServer();
    dataDir = await mkdtemp(join(tmpdir(), 'mcp-oauth-live-'));
    registry = new McpRegistry([config()], {
      oauthDataDir: dataDir,
      oauthRedirectUrl: `${mock.baseUrl}/callback`,
    });
  });

  afterAll(async () => {
    await mock.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('完整链路：startOAuth → 授权 URL → state 还原服务器 → token 交换 → 连接', async () => {
    const start = await registry.startOAuth(serverName);
    expect(start.ok).toBe(true);
    expect(start.authorizationUrl).toBeTruthy();

    // 授权 URL 的 state 编码了服务器名
    const authUrl = new URL(start.authorizationUrl!);
    const state = authUrl.searchParams.get('state')!;
    expect(parseOAuthState(state).serverName).toBe(serverName);

    // 模拟浏览器完成授权：请求 authorize URL → mock 302 回 redirect_uri
    const browserRes = await fetch(authUrl, { redirect: 'manual' });
    expect(browserRes.status).toBe(302);
    const callbackUrl = new URL(browserRes.headers.get('location')!);

    // 关键断言：真实回调 URL 不带 server 参数（授权服务器只追加 code/state）
    expect(callbackUrl.searchParams.get('server')).toBeNull();
    expect(callbackUrl.searchParams.get('code')).toBe('mock-code-42');
    const cbState = callbackUrl.searchParams.get('state')!;
    expect(cbState).toBe(state);

    // 回调：从 state 还原服务器名 → 完成 token 交换（等价于 callback route 的核心逻辑）
    const { serverName: fromState } = parseOAuthState(cbState);
    expect(fromState).toBe(serverName);
    const done = await registry.completeOAuth(fromState!, callbackUrl.searchParams.get('code')!, cbState);
    expect(done.ok).toBe(true);

    // 已连接且已授权
    const snap = registry.snapshot().servers.find((s) => s.name === serverName);
    expect(snap?.connected).toBe(true);
    expect(snap?.auth).toBe('connected');
    expect(await registry.hasOAuthAuth(serverName)).toBe(true);
  });

  it('token 请求携带 PKCE code_verifier 与 client_id（public client）', () => {
    expect(mock.lastTokenRequest?.code).toBe('mock-code-42');
    expect(mock.lastTokenRequest?.codeVerifier).toBeTruthy();
    expect(mock.lastTokenRequest?.clientId).toBe('mock-client-id');
  });

  it('已授权后 connectAll 复用 token，不重复 DCR', async () => {
    // 重建 registry（同 dataDir，token 已持久化）→ 直接连上，无需再注册 client
    const registry2 = new McpRegistry([config()], {
      oauthDataDir: dataDir,
      oauthRedirectUrl: `${mock.baseUrl}/callback`,
    });
    await registry2.connectAll();
    const snap = registry2.snapshot().servers.find((s) => s.name === serverName);
    expect(snap?.connected).toBe(true);
    expect(snap?.auth).toBe('connected');
    expect(mock.registeredClients.length).toBe(1);
  });
});
