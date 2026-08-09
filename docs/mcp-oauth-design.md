# MCP OAuth 接入设计（TheThing 桌面应用）

> 状态：待评审 · 日期：2026-08-08 · 关联：[MCP 2026-07-28 升级方案](mcp-2026-07-28-upgrade.md)（本设计属其中阶段 1）

## 1. 背景与目标

**缺口**：当前 [types.ts](../packages/core/src/modules/mcp/types.ts) 的 MCP transport 只支持静态 `headers`，没有任何 OAuth 能力。现代远程 MCP 服务器（GitHub、Slack、Supabase、Figma 等）普遍要求标准 OAuth 2.0 授权，**我们目前连不了这类服务器**。这是 TheThing 的 MCP 功能硬缺口。

**目标**：基于 `@ai-sdk/mcp` 原生 OAuth 支持，接入 **localhost redirect** 授权流程，让用户能添加并连接要求 OAuth 的远程 MCP 服务器。

**非目标**（本次不做，留作扩展）：
- device flow（无本地回环服务器场景的备选）
- 系统 keychain 加密存储 token（先用文件 + 权限位，后续可换）
- 企业 IdP / Enterprise Managed Authorization（本地个人应用无此场景）
- 2026-07-28 的 CIMD（client 注册新协议，SDK 跟进后我们只需持久化新字段）

## 2. 现状梳理

- **config**：[types.ts](../packages/core/src/modules/mcp/types.ts) `McpServerConfig.transport` = `sse | http | streamable-http | stdio`，HTTP 类仅 `{ url, headers }`。
- **连接**：[registry.ts](../packages/core/src/modules/mcp/registry.ts) `connect()` → `createMCPClient({ transport, capabilities, onUncaughtError })` → `client.tools()`。registry 常驻、diff 式热同步（`syncServers`）、超时 + 半死连接重连自愈。
- **SDK 能力（已核实）**：`@ai-sdk/mcp` 原生提供完整 OAuth 流程：
  - `createMCPClient` 的 transport config 接受 `authProvider?: OAuthClientProvider`；
  - 内置 `auth()` / `authInternal()`：发现 metadata → 无 client 则 DCR 注册 → 有 refresh_token 先刷新 → 否则生成 authorizationUrl + PKCE codeVerifier → `provider.redirectToAuthorization(url)` 返回 `REDIRECT`；携带 `authorizationCode` 再进来时校验 state、用 codeVerifier 换 token、`provider.saveTokens()` 返回 `AUTHORIZED`；
  - **issuer 验证已内置**：`metadata.issuer !== expectedIssuer` 报错（对齐 2026-07-28 auth 加固的 RFC 9207）。
  - **注意**：OAuth 流程分两个分离调用完成，provider 必须在中间持久化 state、codeVerifier、clientInformation、authorizationServerInformation（详见 §5.3）。2.0.3 的 provider 接口不完整，**必须先升级 SDK**（见 §4）。
- **数据目录**：`~/.thething`（configDir）+ `~/.thething/data`（dataDir，可经 `~/.thethingrc` 覆盖）——[runtime.ts](../packages/app/lib/runtime.ts)。
- **UI**：[McpSettings.tsx](../packages/app/components/McpSettings.tsx)（645 行），server card 已有「手动连接 / 测试 / 删除」按钮与「已连接 / 未连接」状态徽标。

## 3. 设计决策

| # | 决策 | 结论 | 说明 |
|---|---|---|---|
| D1 | 授权方式 | **localhost redirect**（已确认） | Electron 桌面应用主流方案；2026-07-28 auth 加固（`application_type`）专门允许桌面/CLI 的 localhost redirect |
| D2 | 前置 SDK | **@ai-sdk/mcp ≥ 2.0.29**（推荐） | 2.0.3 provider 接口不完整（缺 state/codeVerifier/redirectUrl），OAuth 需在升级后实施 |
| D3 | 回调承载 | **Next.js API route**（复用 app 现有端口） | 免去独立本地 HTTP server；生产是 Electron 内嵌 next-server，端口已知 |
| D4 | token 存储 | dataDir 下 JSON 文件 + chmod 600 | 简单、可审计；keychain 留作后续 |
| D5 | 授权触发 | 用户点按钮**主动触发**；连接遇 401 也进入授权态 | 不与启动流程耦合，符合"配置即连接、按需授权" |

## 4. 前置：SDK 升级

OAuth 实施前先把 `@ai-sdk/mcp` 2.0.3 → **2.0.29**（协议不变，仍 2025-11-25，无 breaking）。理由：
1. 2.0.29 的 `OAuthClientProvider` 才有完整接口（`state/saveState/storedState`、`codeVerifier/saveCodeVerifier`、`redirectUrl`、`invalidateCredentials`）；
2. 附带 MCP Apps 增强（`detectMCPAppResourceDrift` / `fingerprintMCPAppResource`）；
3. 2.0.29 不再依赖官方 SDK，自带 stdio transport——**决策点**：registry 目前从官方 SDK 导入 `StdioClientTransport`，升级时先保留官方 SDK 依赖（改动最小），后续再评估切换。

> 升级与迁移细节见 [mcp-2026-07-28-upgrade.md](mcp-2026-07-28-upgrade.md) 阶段 0。

## 5. 详细设计

### 5.1 Config 扩展

```ts
// packages/core/src/modules/mcp/types.ts
type McpTransport =
  | { type: 'sse' | 'http' | 'streamable-http'; url: string; headers?: Record<string, string>;
      /** 声明该服务器使用 OAuth 授权。stdio 不可用。 */
      oauth?: { scope?: string } }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> };
```

- `McpServerConfigSchema` 加 `oauth: OAuthTransportSchema.optional()`（校验 `scope` 为字符串）。
- `configsEqual` 的 stable 序列化自动覆盖 `oauth`，配置变更即重建连接——无需改动。
- 向后兼容：无 `oauth` 字段 = 现状（纯 headers）。
- 写盘格式：`toDotAgentsEntry` 需把 `oauth` 透传进 entry（[mcp-config-store.ts](../packages/core/src/modules/mcp/mcp-config-store.ts)）。

### 5.2 持久化

单文件承载一次授权所需的全部跨调用状态。路径：`{dataDir}/mcp-auth/{safeName}.json`，其中 `safeName` 为 config.name 的文件名安全化（替换 `/`、`..`、路径分隔符；建议直接用名称的 SHA-256 短哈希，规避碰撞与路径穿越）。

```ts
interface McpOAuthStateFile {
  version: 1;
  // SDK 换来的 token（含 authorization_server 信息）
  tokens?: OAuthTokens;
  // DCR 注册的 client 信息（同一授权服务器内复用，避免重复注册）
  clientInformation?: OAuthClientInformation;
  // 授权服务器元数据（用于 code 交换时校验 iss 一致）
  authorizationServerInformation?: OAuthAuthorizationServerInformation;
  // 一次授权会话的跨调用状态
  pending?: {
    state: string;          // CSRF state
    codeVerifier: string;   // PKCE
    authorizationServerUrl: string;
    createdAt: number;
  };
}
```

写文件：临时文件 + rename（原子）；`chmod 0o600`；**任何日志路径不得输出 token / codeVerifier / state**（`logger` 里现有字段序列化注意）。读文件：不存在返回空对象；解析失败视为无状态（不阻塞连接）。

### 5.3 OAuthClientProvider 实现

新文件 `packages/core/src/modules/mcp/mcp-oauth.ts`，导出 `createMcpOAuthProvider(serverName, dataDir, hooks)`，返回 `OAuthClientProvider`（以 2.0.29 接口为准）。

| Provider 方法 | 实现 |
|---|---|
| `tokens()` / `saveTokens(t)` | 读写 state 文件 `.tokens` |
| `clientInformation()` / `saveClientInformation(ci)` | 读写 `.clientInformation` |
| `authorizationServerInformation()` / `saveAuthorizationServerInformation(asi)` | 读写 `.authorizationServerInformation` |
| `state()` / `saveState(s)` / `storedState()` | 读写 `.pending.state`。**服务器标识编码进 state**（`encodeURIComponent(serverName)::随机串`）：授权服务器只回跳 redirect_uri + code/state，回调侧靠 state 前缀还原服务器名（`parseOAuthState`）。`storedState()` 返回后清空以单次有效 |
| `codeVerifier()` / `saveCodeVerifier(cv)` | 读写 `.pending.codeVerifier`（交换后清空） |
| `redirectUrl` | `http://127.0.0.1:{appPort}/api/mcp/oauth/callback` |
| `clientMetadata` | `{ client_name: 'The Thing', redirect_uris: [redirectUrl], application_type: 'native' /* 2026-07-28 要求 */, token_endpoint_auth_method: 'none' /* 桌面应用用 PKCE 无 client secret */ }` |
| `redirectToAuthorization(url)` | 通过 `hooks.onAuthorizationRequested(url)` 通知上层（前端打开系统浏览器），不阻塞 |
| `invalidateCredentials(cause)` | 按 cause 清空 state 文件对应字段（服务器判 token 失效时自动清理，避免用户手动干预） |
| `addClientAuthentication?` / `validateAuthorizationServerURL?` / `validateResourceURL?` | 默认不实现（PKCE 已够；issuer 校验 SDK 内置） |

`hooks`：`onAuthorizationRequested(url: URL): void`——由集成方注入，负责把授权 URL 送到前端（见 §5.6/5.8）。

### 5.4 授权时序（两个分离调用）

SDK 的 `auth()` 一次调用只会走「发起」或「完成」其一。完整时序：

```
用户点「授权」               连接时遇 401
   │                            │
   └────────┬───────────────────┘
            ▼
  POST /api/mcp/oauth/start { name }
            ▼
  registry.startOAuth(name)
    → connect() 用带 authProvider 的 transport
    → 首个请求 401 → SDK 进入 authInternal()
      ① 无 client → DCR 注册 → saveClientInformation
      ② 无 refresh_token
      ③ startAuthorization → saveState + saveCodeVerifier
      ④ redirectToAuthorization(authUrl) → hooks 通知前端
      ⑤ 返回 "REDIRECT"
            ▼
  前端收到 authUrl → window.open / 系统浏览器打开
            ▼
  用户在浏览器完成授权
            ▼
  浏览器重定向 → http://127.0.0.1:{port}/api/mcp/oauth/callback?code=..&state=..
  （注意：授权服务器只把注册的 redirect_uri 原样回跳，再追加自己的 code/state，
   绝不会加 server 参数——服务器名编码在 state 里，见 §5.3）
            ▼
  GET /api/mcp/oauth/callback?code=..&state=..
    → 从 state 还原服务器名（parseOAuthState，query 的 ?server= 兼容路径仍保留）
    → registry.completeOAuth(name, code, state)
    → auth() resume：① storedState 校验 state  ② codeVerifier 换 token
      ③ saveTokens → 返回 "AUTHORIZED"
    → 对 name force 重连 → 连接成功
    → 返回成功页（「授权完成，可关闭此窗口」）
            ▼
  前端轮询 /api/mcp?name=X&connect=true → 看到 connected
```

**关键点**：`pending` 里保存的 `state` / `codeVerifier` / `authorizationServerUrl` 必须跨两个 HTTP 调用存活（都落在同一 state 文件，天然满足）。回调回来时校验 `state` 防 CSRF、校验 `authorizationServerInformation.iss` 与当前发现的一致（SDK `assertAuthorizationServerInformationMatches` 内置）。

### 5.5 本地回调

- 用 Next.js API route：`packages/app/app/api/mcp/oauth/callback/route.ts`（GET）。
- 端口：复用 app 现有端口（`redirectUrl` 由运行时布局告知 provider，见 §5.6 接线）。127.0.0.1 保证只在本地可达。
- 授权会话超时：`pending.createdAt` 超过 5 分钟视为过期，回调时拒绝并清理。
- 浏览器端：回调返回一个极简 HTML（Next.js 返回 `text/html`），提示「授权成功，请回到 The Thing」。前端可同时用轮询或事件通道感知。

### 5.6 Registry 集成

[registry.ts](../packages/core/src/modules/mcp/registry.ts) 改动：

1. **transport 构造**（`_createTransport`）：HTTP 类 transport 配置里若 `config.transport.oauth` 存在，注入 `authProvider: createMcpOAuthProvider(name, dataDir, hooks)`。`hooks.onAuthorizationRequested` 由 registry 构造时经 option 传入（AppContext 已有 mcpRegistry，接线到前端事件总线 / SSE / 轮询队列）。
2. **状态机**：`McpClientConnection` 增加 `auth?: 'required' | 'pending' | 'connected'`。`connect()` 失败若是 `UnauthorizedError` → 置 `auth: 'required'`（snapshot 呈现「需要授权」）；`startOAuth` 后置 `pending`；`completeOAuth` 成功 force 重连后置 `connected`。
3. **新增方法**：
   - `startOAuth(name): Promise<{ ok: boolean; error?: string }>` —— 以 force 重连触发 SDK 授权（复用现有 `connect(config, { force: true })`，靠 401 → authProvider 驱动）；
   - `completeOAuth(name, code, state): Promise<{ ok; error? }>` —— 调用 `auth(provider, { serverUrl, authorizationCode: code, callbackState: state })`，成功后 `connect(config, { force: true })`。
   - `hasOAuthAuth(name): boolean` —— 供 UI 判断是否显示「授权」按钮。
4. **并发单飞**：同 name 的 `startOAuth` 若已有 pending，直接返回"进行中"，避免重复开授权页。

### 5.7 API 层

在 [api/mcp/route.ts](../packages/app/app/api/mcp/route.ts) 与新增 route 中暴露：

- `POST /api/mcp/oauth/start` `{ name }` → `registry.startOAuth`；返回 `{ ok, authUrl? }`（authUrl 供前端直接打开）。
- `GET /api/mcp/oauth/callback?code=..&state=..` → 从 state 还原服务器名（`parseOAuthState`；query 的 `?server=` 仍接受为兼容路径）→ `registry.completeOAuth` → 返回成功/失败 HTML 页。
- `GET /api/mcp?name=X&connect=true` 现有返回的 snapshot 补 `auth` 字段（UI 读它渲染按钮状态）。

接线：route 通过现有 `loadAgentContext()` / `getServerContext()` 拿共享 `mcpRegistry`（[proxy/route.ts](../packages/app/app/api/mcp/proxy/route.ts) 同款模式）。

### 5.8 前端 UI（[McpSettings.tsx](../packages/app/components/McpSettings.tsx)）

- server card 状态徽标区：`auth: 'required'` → 「需要授权」橙色徽标 + **「授权」按钮**（新增，紧邻现有「手动连接」）。
- 点击授权 → `POST /api/mcp/oauth/start` → 收到 `authUrl` 后 `window.open(authUrl, '_blank')` 打开系统浏览器；卡片进入「正在等待浏览器授权…」（`pending`），**带 5 分钟倒计时**。
- 授权完成：轮询 `GET /api/mcp?name=X&connect=true`（沿用现有 `waitForMcpReady` + force 语义）或前端事件通道 → 徽标转「已连接」。
- 失败：显示错误原因（SDK 错误消息 sanitize，避免泄露 token）。

### 5.9 刷新 / 登出

- **刷新**：SDK 自动处理——每次连接 `authInternal` 先尝试 `refresh_token`（成功 `saveTokens`）。我们只需持久化，无需自己写刷新逻辑。
- **登出**：新增 `DELETE /api/mcp/oauth?name=X` → 删除 state 文件 → 置 `auth: 'required'`。UI 在「已连接」卡片的更多菜单里加「重新授权 / 断开授权」。（是否调服务器 revoke endpoint：规范不强制，先不做。）

## 6. 安全清单

- [ ] PKCE：SDK 内置（`pkce-challenge` 依赖），我们负责 `codeVerifier` 跨调用持久化。
- [ ] CSRF state：`storedState` 校验（SDK 内置），我们保证 state 单次有效。
- [ ] issuer 验证：SDK 内置（RFC 9207），我们持久化 `authorizationServerInformation` 供校验。
- [ ] 回调只接受 `127.0.0.1`：redirectUrl 硬编码 localhost，不响应外部来源。
- [ ] token 落盘 `chmod 600` + 原子写；日志零泄漏。
- [ ] scope 最小化：`oauth.scope` 显式声明，不默认全量。
- [ ] `application_type: 'native'`：满足 2026-07-28 对桌面应用的声明要求。
- [ ] pending 会话 5 分钟超时。

## 7. 验证方案

1. **单元测试**（`packages/core/src/modules/mcp/__tests__/mcp-oauth.test.ts`）——✅ 已实现（2026-08-09）：
   - provider 各方法读写 state 文件、权限位、原子写；
   - 并发 `startOAuth` 单飞；pending 超时拒绝回调；`completeOAuth` state 不匹配报 CSRF 错误；
   - `parseOAuthState` 还原服务器名；`resetOAuth` 登出回到 required。
2. **mock 集成测试**（`packages/core/src/modules/mcp/__tests__/mcp-oauth-live.test.ts`）——✅ 已实现：
   - 内联起一个真实本地 mock OAuth MCP server（`401+WWW-Authenticate → protected-resource/authorization-server metadata → DCR → authorize(302) → token`），**不 mock @ai-sdk/mcp**，跑通 `startOAuth → 授权 URL → state 还原服务器 → completeOAuth → 连接 → 已授权后复用 token 不重复 DCR` 完整链路。
3. **live 验收**（未做，待真实网络环境）：添加真实要求 OAuth 的 MCP 服务器（如 GitHub 官方 server），验证授权 → 连接 → 工具调用 → 重启后 token 复用（免重授权）→ 登出/重新授权。
4. **回归**：现有 `mcp.test.ts` / `mcp-live-smoke.test.ts` 全绿；纯 headers 服务器行为不变（core 全量 931 测试通过）。

## 8. 里程碑

| 里程碑 | 内容 | 验收 | 状态 |
|---|---|---|---|
| M1 | SDK 升级 2.0.3 → 2.0.29（阶段 0） | 现有 MCP 测试全绿、MCP Apps 渲染回归 | ✅ 完成 |
| M2 | config + provider + 持久化（§5.1-5.3） | 单元测试通过 | ✅ 完成 |
| M3 | 回调 route + registry 集成 + API（§5.5-5.7） | mock 集成测试通过 | ✅ 完成 |
| M4 | 前端 UI（§5.8，含登出/重新授权 §5.9） | 手动走通授权流程 | ✅ 完成（live 验收前） |
| M5 | live 验收 + 安全清单复核 | GitHub server 全流程可用 | ⏳ 待真实网络环境 |

实施补充（相对设计）：`application_type: 'native'` 因 SDK 2.0.29 类型未支持而暂缺（代码注释标注）；登出/重新授权已加 `DELETE /api/mcp/oauth` + UI 菜单；回调识别服务器改用 **state 编码服务器名**（授权服务器只回跳 redirect_uri + code/state，不会带 server 参数）。

## 9. 与 2026-07-28 的关系（后续扩展点）

- 本设计对齐了 auth 加固主体（iss 验证、`application_type`、issuer 绑定——SDK 已含或我们已声明）。
- **CIMD 取代 DCR**：若 SDK 跟进，client 注册持久化字段变化，我们只需扩展 state 文件 schema（版本化 `version: 1` 已预留）。
- **stateless / MRTR**：不影响 OAuth 主体流程；MRTR 是 elicitation 的迁移动向（见升级方案阶段 2/3）。
- **device flow**：若遇到不支持 authorization code 的服务器，可加回退，provider 持久化结构不变（仅 `redirectToAuthorization` 换成 code 展示 + 轮询）。
