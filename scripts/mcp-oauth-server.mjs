#!/usr/bin/env node
// ============================================================
// Standalone MCP OAuth mock server（本地验证用）
// ============================================================
// 用法：node scripts/mcp-oauth-server.mjs [port]
// 默认监听 127.0.0.1:4399。
//
// 模拟一个要求 OAuth 的远程 MCP 服务器，驱动 TheThing 的完整授权链路：
//   MCP 请求 401（WWW-Authenticate: Bearer resource_metadata）→
//   OAuth protected resource / authorization server metadata → DCR →
//   authorize（302 回 redirect_uri，追加 code+state）→ token exchange →
//   带 Bearer 的 JSON-RPC（initialize / tools/list / tools/call）。
//
// 与 __tests__/mcp-oauth-live.test.ts 共用同一套协议形状（经真实 SDK 验证），
// 这里额外支持 tools/call 与运行日志，供人工在 TheThing 设置页/对话中验收。
//
// 配置示例（~/.thething/mcp.json 或项目 .agents/mcp.json）：
//   { "mcpServers": { "oauth-demo": {
//       "type": "http", "url": "http://127.0.0.1:4399/mcp",
//       "oauth": { "scope": "test" }
//     } } }

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const port = Number(process.argv[2] ?? 4399);
const host = '127.0.0.1';
const baseUrl = `http://${host}:${port}`;

const VALID_TOKEN = 'mock-access-token';
const registeredClients = [];
let lastAuthorize = null; // 最近一次授权请求（client_id/state/redirect_uri）

const log = (tag, msg) => console.log(`[oauth-mock] ${tag} ${msg}`);

// 简单 Bearer token 校验：mock 只认一个固定 token
const isAuthed = (req) => (req.headers.authorization ?? '').startsWith(`Bearer ${VALID_TOKEN}`);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', baseUrl);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  const json = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const readBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });

  // ── MCP endpoint ────────────────────────────────────────
  if (path === '/mcp' && method === 'POST') {
    if (!isAuthed(req)) {
      log('401', 'no/invalid Bearer token → 触发 OAuth 流程');
      res.writeHead(401, {
        'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      });
      res.end();
      return;
    }
    void readBody().then((body) => {
      const msg = JSON.parse(body);
      if (msg.method === 'initialize') {
        log('rpc', `initialize (id=${msg.id})`);
        json(200, {
          jsonrpc: '2.0', id: msg.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'oauth-demo', version: '1.0.0' },
          },
        });
      } else if (msg.method === 'tools/list') {
        log('rpc', `tools/list (id=${msg.id})`);
        json(200, {
          jsonrpc: '2.0', id: msg.id,
          result: {
            tools: [
              {
                name: 'echo',
                description: 'Echo the input text back',
                inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
              },
              {
                name: 'get_weather',
                description: '演示用：返回一个城市天气（假数据）',
                inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
              },
            ],
          },
        });
      } else if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params ?? {};
        log('rpc', `tools/call ${name} (id=${msg.id})`);
        if (name === 'echo') {
          json(200, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo: ${args?.text ?? ''}` }], isError: false } });
        } else if (name === 'get_weather') {
          json(200, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `今日 ${args?.city} 晴，25°C` }], isError: false } });
        } else {
          json(200, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true } });
        }
      } else {
        json(200, { jsonrpc: '2.0', id: msg.id, result: {} });
      }
    });
    return;
  }

  // ── OAuth protected resource metadata ───────────────────
  if (path === '/.well-known/oauth-protected-resource') {
    json(200, { resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl] });
    return;
  }

  // ── authorization server metadata ───────────────────────
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

  // ── DCR ─────────────────────────────────────────────────
  if (path === '/register' && method === 'POST') {
    void readBody().then((body) => {
      const metadata = JSON.parse(body);
      registeredClients.push(metadata);
      log('dcr', `client registered: ${metadata.client_name} (redirect_uris=${JSON.stringify(metadata.redirect_uris)})`);
      json(201, {
        client_id: 'mock-client-id',
        redirect_uris: metadata.redirect_uris,
        token_endpoint_auth_method: 'none',
      });
    });
    return;
  }

  // ── authorize（模拟浏览器：302 回 redirect_uri + code + state）──
  if (path === '/authorize' && method === 'GET') {
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const state = url.searchParams.get('state') ?? '';
    lastAuthorize = { clientId: url.searchParams.get('client_id'), state, redirectUri };
    log('authorize', `state=${state.slice(0, 24)}… code_challenge=${url.searchParams.get('code_challenge')?.slice(0, 12)}…`);
    // 模拟"用户已登录并同意"：直接 302 回回调
    const cb = new URL(redirectUri);
    cb.searchParams.set('code', 'mock-code-42');
    cb.searchParams.set('state', state);
    res.writeHead(302, { Location: cb.toString() });
    res.end();
    return;
  }

  // ── token exchange ──────────────────────────────────────
  if (path === '/token' && method === 'POST') {
    void readBody().then((body) => {
      const params = new URLSearchParams(body);
      const grant = params.get('grant_type');
      log('token', `${grant} code=${params.get('code')} code_verifier=${params.get('code_verifier')?.slice(0, 8)}… client_id=${params.get('client_id')}`);
      if (grant === 'refresh_token') {
        json(200, { access_token: 'mock-at-refreshed', token_type: 'Bearer', expires_in: 3600, refresh_token: 'mock-rt', scope: 'test' });
      } else {
        json(200, { access_token: VALID_TOKEN, token_type: 'Bearer', expires_in: 3600, refresh_token: 'mock-rt', scope: 'test' });
      }
    });
    return;
  }

  json(404, { error: 'not found' });
});

server.listen(port, host, () => {
  console.log('');
  console.log('  ┌────────────────────────────────────────────────────────────┐');
  console.log('  │  MCP OAuth mock server 已启动（本地验证用）                │');
  console.log('  └────────────────────────────────────────────────────────────┘');
  console.log(`  MCP endpoint:   ${baseUrl}/mcp`);
  console.log(`  OAuth AS:       ${baseUrl}（.well-known/oauth-authorization-server）`);
  console.log('');
  console.log('  配置到 TheThing 的 mcp.json（~/.thething/mcp.json 或项目 .agents/mcp.json）：');
  console.log('  { "mcpServers": { "oauth-demo": {');
  console.log(`      "type": "http", "url": "${baseUrl}/mcp",`);
  console.log('      "oauth": { "scope": "test" }');
  console.log('  } } }');
  console.log('');
  console.log('  验证步骤：');
  console.log('  1. 启动 TheThing（pnpm dev:next 或桌面版）');
  console.log('  2. 设置 → MCP 设置：oauth-demo 卡片显示「需要授权」');
  console.log('  3. 点「授权」→ 浏览器打开授权页并自动跳回本地回调');
  console.log('  4. 卡片变「已连接」后，在对话中让 agent 调用 mcp__oauth-demo__echo 工具');
  console.log('     （或 mcp__oauth-demo__get_weather 查天气，均为 mock 数据）');
  console.log('  5. 重启应用验证 token 复用（免重新授权）；菜单「重新授权」可登出');
  console.log('');
  console.log('  Ctrl+C 停止');
});
