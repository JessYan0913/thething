# TheThing MCP 2026-07-28 升级方案

> 状态：待评审 · 日期：2026-08-08 · 结论基于对 npm 最新包 tarball 的实检（2026-08-08）

## 0. 关键事实（决定方案走向）

| 包 | 最新版 | 发布时间 | 协议版本（实检） |
|---|---|---|---|
| @modelcontextprotocol/sdk | 1.30.0 | 2026-07-27 | 仍 `2025-11-25` |
| @ai-sdk/mcp | 2.0.29 | 2026-08-07 | 仍 `2025-11-25` |

**官方 TypeScript 生态尚未实现 2026-07-28 的 stateless core**。博客发布的是规范 + 迁移指南，SDK 落地未到正式版。因此：

- **「升级到 2026-07-28」暂无上游可执行路径**；
- 方案拆两条线：**立即行动线**（SDK 补丁 + OAuth + elicitation）与**面向未来准备线**（stateless/MRTR 待上游）。
- 参考：[Bringing MCP 2026-07-28 to Claude](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude) · [官方发布公告](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

## 1. 阶段 0：SDK 补丁升级（低风险，约 0.5 天）

- `@ai-sdk/mcp` 2.0.3 → 2.0.29；`@modelcontextprotocol/sdk` 1.29.0 → 1.30.0。
- 协议不变，无 breaking。收益：OAuth provider 完整接口（OAuth 前置条件）、MCP Apps 增强（`detectMCPAppResourceDrift` / `fingerprintMCPAppResource`）。
- **注意**：2.0.29 不再依赖官方 SDK、自带 stdio transport（`Experimental_StdioMCPTransport`）。[registry.ts](../packages/core/src/modules/mcp/registry.ts) 目前从官方 SDK 导入 `StdioClientTransport`。**决策点 D1**：先保留官方 SDK 依赖（改动最小），后续再评估切换。
- 验证：`mcp.test.ts` + `mcp-live-smoke.test.ts` + MCP Apps 渲染回归。

## 2. 阶段 1：OAuth 接入（最大功能缺口）

- 现状：只有静态 headers，连不了要求标准 OAuth 的现代远程 MCP 服务器。
- 已确认 `@ai-sdk/mcp` 原生支持：`authProvider` + 内置 `auth()` 完整流程 + issuer 验证（RFC 9207）。
- 授权方式定 **localhost redirect**。
- **详细设计见 [mcp-oauth-design.md](mcp-oauth-design.md)**（config / 持久化 / provider / 时序 / 回调 / registry / API / UI / 安全 / 验证 / 里程碑）。

## 3. 阶段 2：elicitation 接入（悬空功能收尾）

- 现状：config 位、capability 声明、handler 注册机制都在（[types.ts](../packages/core/src/modules/mcp/types.ts) / [registry.ts](../packages/core/src/modules/mcp/registry.ts)），但 **handler 全项目无注入点** → 能力不变式使 capability 从未声明 → 功能完全未激活（已 grep 确认）。
- 设计要点：
  - 注入点：`loadAllTools`（[tools.ts](../packages/core/src/modules/agent/tools.ts)）组装 config 时注入默认 handler；
  - **决策点 D3**：UX 选 ask_user_question（推荐）vs toolApproval vs 自动接受 `applyDefaults`；
  - handler 接口 `(message, schema) → {action, content}` 保持协议无关——2026-07-28 会迁到 MRTR（`input_required` + `inputResponses`），届时只换接入层。

## 4. 阶段 3（待上游）：2026-07-28 stateless / MRTR 适配

- **触发条件**：官方 SDK 或 @ai-sdk/mcp 发布支持 2026-07-28 的版本（现均未支持）。
- 届时改动面：无 initialize 握手 / 无 `Mcp-Session-Id`、请求头 `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name`、`tools/list` 返回 `ttlMs`/`cacheScope` 需列表缓存、HTTP+SSE deprecated（12 个月过渡，我们支持 `sse`）、elicitation → MRTR。
- 现在只做一件事：在 [registry.ts](../packages/core/src/modules/mcp/registry.ts) 标注 session 依赖点（initialize / sessionId / `terminateSessionOnClose`）。**不做 speculative 抽象**——stateless 对本地常驻连接模型本就更差；届时 SDK 若支持双模式，保留常驻连接，仅适配"只支持新版协议的服务器"。

## 5. 决策点记录

| # | 决策 | 结论 | 状态 |
|---|---|---|---|
| D1 | 阶段 0 transport 保留官方 SDK vs 切自带 | 保留官方 SDK（改动最小） | 待实施时确认 |
| D2 | 阶段 1 授权方式 | localhost redirect | 已定 |
| D3 | 阶段 2 elicitation UX | 待定（推荐 ask_user_question） | 未定 |
| D4 | 实施范围 | 先出详细设计（本次） | 已定 |
