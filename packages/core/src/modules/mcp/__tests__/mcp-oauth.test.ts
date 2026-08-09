import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpOAuthProvider, parseOAuthState, type McpOAuthProviderHandle } from '../mcp-oauth';
import { McpRegistry } from '../registry';
import { McpServerConfigSchema, type McpServerConfig } from '../types';

// mock @ai-sdk/mcp：registry 的 createMCPClient（不碰真实网络）+ mcp-oauth 的 auth()
vi.mock('@ai-sdk/mcp', () => {
  const fakeClient = {
    tools: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
    onElicitationRequest: vi.fn(),
  };
  return {
    createMCPClient: vi.fn().mockResolvedValue(fakeClient),
    mcpAppClientCapabilities: {},
    auth: vi.fn().mockResolvedValue('AUTHORIZED'),
  };
});

// ============================================================
// 测试工具
// ============================================================

let dataDir: string;
let now = 0;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mcp-oauth-test-'));
  now = 1_000_000_000_000;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function makeProvider(serverName = 'github'): McpOAuthProviderHandle {
  return createMcpOAuthProvider(serverName, {
    dataDir,
    redirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback',
    scope: 'repo read:org',
    now: () => now,
  });
}

/** 找到该 server 的状态文件绝对路径（sha256(name) 前 16 位） */
function statePath(serverName = 'github'): string {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const hash = createHash('sha256').update(serverName).digest('hex').slice(0, 16);
  return join(dataDir, 'mcp-auth', `${hash}.json`);
}

// ============================================================
// Provider 持久化
// ============================================================

describe('McpOAuthProvider', () => {
  it('持久化 tokens', async () => {
    const p = makeProvider();
    await p.saveTokens({ access_token: 'at-1', token_type: 'Bearer', scope: 'repo' });
    expect(await p.tokens()).toEqual({ access_token: 'at-1', token_type: 'Bearer', scope: 'repo' });
  });

  it('持久化 clientInformation（DCR 注册结果）', async () => {
    const p = makeProvider();
    await p.saveClientInformation({ client_id: 'cid-1', client_secret: 'cs-1' });
    expect(await p.clientInformation()).toEqual({ client_id: 'cid-1', client_secret: 'cs-1' });
  });

  it('跨调用持久化 state 与 codeVerifier（两个分离调用之间的桥梁）', async () => {
    const p = makeProvider();
    const state = p.state();
    await p.saveState(state);
    await p.saveCodeVerifier('pkce-verifier-123');
    expect(await p.storedState()).toBe(state);
    expect(await p.codeVerifier()).toBe('pkce-verifier-123');
  });

  it('state 单次生成随机', () => {
    const p = makeProvider();
    const a = p.state();
    const b = p.state();
    expect(a).not.toBe(b);
  });

  it('clientMetadata 声明桌面 PKCE 配置与 redirect_uris', () => {
    const p = makeProvider();
    const md = p.clientMetadata;
    expect(md.redirect_uris).toEqual(['http://127.0.0.1:3000/api/mcp/oauth/callback']);
    expect(md.client_name).toBe('The Thing');
    expect(md.token_endpoint_auth_method).toBe('none');
    expect(md.scope).toBe('repo read:org');
  });

  it('invalidateCredentials 按作用域清理', async () => {
    const p = makeProvider();
    await p.saveTokens({ access_token: 'at', token_type: 'Bearer' });
    await p.saveClientInformation({ client_id: 'cid' });
    await p.invalidateCredentials('tokens');
    expect(await p.tokens()).toBeUndefined();
    expect(await p.clientInformation()).toEqual({ client_id: 'cid' });
  });

  it('hasValidTokens 只在有 access_token 时为 true', async () => {
    const p = makeProvider();
    expect(await p.hasValidTokens()).toBe(false);
    await p.saveTokens({ access_token: 'at', token_type: 'Bearer' });
    expect(await p.hasValidTokens()).toBe(true);
  });

  it('状态文件权限为 0600', async () => {
    const p = makeProvider();
    await p.saveTokens({ access_token: 'at', token_type: 'Bearer' });
    const st = await stat(statePath());
    // 0600：owner 读写，无 group/other 权限
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('状态文件不落任何日志（文件内容只含 JSON）', async () => {
    const p = makeProvider();
    await p.saveTokens({ access_token: 'secret-token-xyz', token_type: 'Bearer' });
    const raw = await readFile(statePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.tokens.access_token).toBe('secret-token-xyz');
  });
});

// ============================================================
// completeAuthorization（授权完成流程）
// ============================================================

describe('completeAuthorization', () => {
  it('无进行中的授权会话时报错', async () => {
    const p = makeProvider();
    await expect(p.completeAuthorization('https://mcp.example.com/mcp', 'code-1', 'state-1'))
      .rejects.toThrow('没有进行中的授权请求');
  });

  it('授权会话过期（>5 分钟）时报错并清理 pending', async () => {
    const p = makeProvider();
    await p.saveState('st');
    await p.saveCodeVerifier('cv');
    // 快进 6 分钟
    now += 6 * 60 * 1000;
    await expect(p.completeAuthorization('https://mcp.example.com/mcp', 'code-1', 'st'))
      .rejects.toThrow('已过期');
    expect(await p.getPendingState()).toBeUndefined();
  });

  it('成功交换 token 并清理 pending', async () => {
    const { auth } = await import('@ai-sdk/mcp');
    const p = makeProvider();
    await p.saveState('st');
    await p.saveCodeVerifier('cv');
    await p.completeAuthorization('https://mcp.example.com/mcp', 'code-1', 'st');
    expect(auth).toHaveBeenCalledTimes(1);
    expect(await p.getPendingState()).toBeUndefined();
  });

  it('SDK 报错（如 CSRF state 不匹配）时错误上抛', async () => {
    const { auth } = await import('@ai-sdk/mcp');
    vi.mocked(auth).mockRejectedValueOnce(new Error('OAuth state parameter mismatch - possible CSRF attack'));
    const p = makeProvider();
    await p.saveState('st');
    await p.saveCodeVerifier('cv');
    await expect(p.completeAuthorization('https://mcp.example.com/mcp', 'code-1', 'wrong-state'))
      .rejects.toThrow('CSRF');
  });
});

// ============================================================
// Registry 集成
// ============================================================

describe('McpRegistry OAuth 集成', () => {
  const oauthConfig: McpServerConfig = {
    name: 'github',
    transport: { type: 'http', url: 'https://api.github.com/mcp', oauth: { scope: 'repo' } },
    enabled: true,
  };

  it('snapshot：oauth 服务器未连接时 auth=required，非 oauth 无 auth 字段', () => {
    const registry = new McpRegistry(
      [
        oauthConfig,
        { name: 'plain', transport: { type: 'http', url: 'https://example.com/mcp' }, enabled: true },
      ],
      { oauthDataDir: dataDir, oauthRedirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback' },
    );
    const snap = registry.snapshot();
    const github = snap.servers.find((s) => s.name === 'github');
    const plain = snap.servers.find((s) => s.name === 'plain');
    expect(github?.auth).toBe('required');
    expect(plain?.auth).toBeUndefined();
  });

  it('hasOAuthAuth 反映 token 是否存在', async () => {
    const registry = new McpRegistry([oauthConfig], {
      oauthDataDir: dataDir,
      oauthRedirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback',
    });
    expect(await registry.hasOAuthAuth('github')).toBe(false);
    // 直接写 token 文件模拟已授权
    const p = createMcpOAuthProvider('github', { dataDir, redirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback' });
    await p.saveTokens({ access_token: 'at', token_type: 'Bearer' });
    expect(await registry.hasOAuthAuth('github')).toBe(true);
  });

  it('startOAuth 单飞：pending 中重复调用不重复触发', async () => {
    const registry = new McpRegistry([oauthConfig], {
      oauthDataDir: dataDir,
      oauthRedirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback',
    });
    const first = await registry.startOAuth('github');
    expect(first.ok).toBe(true);
    // 第二次：pending 单飞
    const second = await registry.startOAuth('github');
    expect(second.ok).toBe(true);
    expect(registry.snapshot().servers.find((s) => s.name === 'github')?.auth).toBe('pending');
  });

  it('completeOAuth 成功后连接（auth=connected）', async () => {
    // 预置授权会话（真实流程由 startOAuth 触发 SDK 授权时写入）
    const p = createMcpOAuthProvider('github', { dataDir, redirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback' });
    await p.saveState('st');
    await p.saveCodeVerifier('cv');

    const registry = new McpRegistry([oauthConfig], {
      oauthDataDir: dataDir,
      oauthRedirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback',
    });
    const result = await registry.completeOAuth('github', 'code-1', 'st');
    expect(result.ok).toBe(true);
    const github = registry.snapshot().servers.find((s) => s.name === 'github');
    expect(github?.connected).toBe(true);
    expect(github?.auth).toBe('connected');
  });

  it('未配置 OAuth 的服务器 startOAuth 报错', async () => {
    const registry = new McpRegistry(
      [{ name: 'plain', transport: { type: 'http', url: 'https://example.com/mcp' }, enabled: true }],
      { oauthDataDir: dataDir, oauthRedirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback' },
    );
    const result = await registry.startOAuth('plain');
    expect(result.ok).toBe(false);
  });

  it('connectAll 跳过未授权的 OAuth 服务器（不触发授权、不建立连接）', async () => {
    const { createMCPClient } = await import('@ai-sdk/mcp');
    const registry = new McpRegistry([oauthConfig], {
      oauthDataDir: dataDir,
      oauthRedirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback',
    });
    await registry.connectAll();
    const github = registry.snapshot().servers.find((s) => s.name === 'github');
    expect(github?.connected).toBe(false);
    expect(github?.auth).toBe('required');
    expect(createMCPClient).not.toHaveBeenCalled();
  });

  it('connectAll 正常连接已授权的 OAuth 服务器', async () => {
    const p = createMcpOAuthProvider('github', { dataDir, redirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback' });
    await p.saveTokens({ access_token: 'at', token_type: 'Bearer' });

    const registry = new McpRegistry([oauthConfig], {
      oauthDataDir: dataDir,
      oauthRedirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback',
    });
    await registry.connectAll();
    const github = registry.snapshot().servers.find((s) => s.name === 'github');
    expect(github?.connected).toBe(true);
    expect(github?.auth).toBe('connected');
  });

  it('resetOAuth 清除 token 并回到 required（登出/重新授权）', async () => {
    const p = createMcpOAuthProvider('github', { dataDir, redirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback' });
    await p.saveTokens({ access_token: 'at', token_type: 'Bearer' });

    const registry = new McpRegistry([oauthConfig], {
      oauthDataDir: dataDir,
      oauthRedirectUrl: 'http://127.0.0.1:3000/api/mcp/oauth/callback',
    });
    const result = await registry.resetOAuth('github');
    expect(result.ok).toBe(true);
    expect(await registry.hasOAuthAuth('github')).toBe(false);
    const github = registry.snapshot().servers.find((s) => s.name === 'github');
    expect(github?.auth).toBe('required');
    expect(github?.connected).toBe(false);
  });
});

// ============================================================
// parseOAuthState（回调还原服务器名）
// ============================================================

describe('parseOAuthState', () => {
  it('从编码 state 还原服务器名与 CSRF 部分', () => {
    const parsed = parseOAuthState('github::abc123def');
    expect(parsed.serverName).toBe('github');
    expect(parsed.csrf).toBe('abc123def');
  });

  it('URL 编码的服务器名（含特殊字符）可还原', () => {
    const parsed = parseOAuthState('my%20server%2Fbeta::xyz');
    expect(parsed.serverName).toBe('my server/beta');
  });

  it('旧格式（无分隔符）时 serverName 为 undefined', () => {
    const parsed = parseOAuthState('legacy-random-state');
    expect(parsed.serverName).toBeUndefined();
    expect(parsed.csrf).toBe('legacy-random-state');
  });
});

// ============================================================
// Schema 校验
// ============================================================

describe('McpServerConfigSchema oauth', () => {
  it('接受 transport.oauth（scope）', () => {
    const parsed = McpServerConfigSchema.safeParse({
      name: 'github',
      transport: { type: 'http', url: 'https://api.github.com/mcp', oauth: { scope: 'repo' } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.transport).toMatchObject({ type: 'http', oauth: { scope: 'repo' } });
    }
  });

  it('transport.oauth 可省略（向后兼容）', () => {
    const parsed = McpServerConfigSchema.safeParse({
      name: 'plain',
      transport: { type: 'http', url: 'https://example.com/mcp' },
    });
    expect(parsed.success).toBe(true);
  });

  it('stdio transport 的 oauth 字段被忽略（schema strip，运行时语义=不支持）', () => {
    const parsed = McpServerConfigSchema.safeParse({
      name: 'local',
      transport: { type: 'stdio', command: 'node', oauth: { scope: 'x' } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // zod object 默认 strip 未知字段：stdio transport 上不保留 oauth
      expect('oauth' in (parsed.data.transport as { oauth?: unknown })).toBe(false);
    }
  });
});
