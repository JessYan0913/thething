# Claude Code 差距分析与 AI SDK v6 补齐方案

> 基于项目实际代码审计（2026-04-15 更新）

## 文档信息

- **创建日期**: 2026-04-15
- **最后更新**: 2026-04-15（代码审计更新）
- **参考来源**:
  - 当前项目源码全面审计 (`E:\thething/src/` 逐文件审查)
  - [AI SDK v6 官方文档](https://ai-sdk.dev/docs)
  - AI SDK v6.0.149 实际 API
- **工作场景**: 企业级私有化部署，中心化云服务器/内部服务器，多用户/团队使用

---

## 目录

- [1. 项目现状概述](#1-项目现状概述)
- [2. 差距分类总览](#2-差距分类总览)
- [3. 核心架构差距（P0）](#3-核心架构差距p0)
- [4. 工具系统差距（P1）](#4-工具系统差距p1)
- [5. 可靠性与容错差距（P1）](#5-可靠性与容错差距p1)
- [6. 架构模式差距（P2）](#6-架构模式差距p2)
- [7. 可观测性与扩展性差距（P2）](#7-可观测性与扩展性差距p2)
- [8. AI SDK v6 能力盘点](#8-ai-sdk-v6-能力盘点)
- [9. 补齐方案：按 SDK 可行性分类](#9-补齐方案按-sdk-可行性分类)
- [10. 工作场景驱动的实施优先级](#10-工作场景驱动的实施优先级)
- [11. 架构决策建议](#11-架构决策建议)

---

## 1. 项目现状概述

### 1.1 项目定位

| 维度 | 值 |
|---|---|
| 项目类型 | Next.js 16 Web 应用 |
| AI SDK | `ai` v6.0.149 (LanguageModelV3 middleware spec) |
| LLM 提供商 | DashScope（通义千问，OpenAI 兼容接口） |
| 持久化 | SQLite (`better-sqlite3`) at `.data/chat.db` |
| 部署模式 | 企业级私有化部署，中心化云服务器/内部服务器 |

### 1.2 当前已有能力（2026-04-15 审计确认）

| 能力 | 状态 | 说明 | 源码位置 |
|---|---|---|---|
| **文件级记忆系统** | ✅ | 完整实现：文件存储 + MEMORY.md + 四类型分类法 + 智能召回 + 老化追踪 + LLM 提取 + SQLite 索引 | `src/lib/memory/` (9 文件) |
| **四层上下文压缩** | ✅ | micro, session-memory, PTL, API + background queue | `src/lib/compaction/` (13 文件) |
| **压缩断路器** | ✅ | 连续 3 失败 trip，5 分钟冷却 | `src/lib/compaction/auto-compact.ts` |
| **动态系统提示词** | ✅ | 13 Section 工厂 + 三级缓存（static/session/dynamic） | `src/lib/system-prompt/` |
| **Token 预算追踪** | ✅ | `TokenBudgetTracker` + 累积报告 | `src/lib/session-state/token-budget.ts` |
| **成本追踪** | ✅ | 按模型定价表 + SQLite 持久化 | `src/lib/session-state/cost.ts` + middleware |
| **Denial Tracking** | ✅ | 每工具拒绝次数追踪 + circuit breaker | `src/lib/agent-control/denial-tracking.ts` |
| **模型切换** | ✅ | 用户意图/成本预算/任务复杂度三维切换 | `src/lib/agent-control/model-switching.ts` |
| **子代理框架** | ✅ | 7 代理 + 路由 + 流式广播 + 任务同步 | `src/lib/subagents/` |
| **技能系统** | ✅ | 9 技能包，关键词激活 + 路径条件激活 + half-life 排名 | `src/lib/skills/` (8 文件) |
| **任务系统** | ✅ | 状态机 + 依赖图 + 代理认领 + 工具套件 | `src/lib/tasks/` (10 文件) |
| **Guardrails 中间件** | ✅ | PII 红化（SSN/邮箱/信用卡），wrapGenerate + wrapStream | `src/lib/middleware/guardrails.ts` |
| **Telemetry 中间件** | ✅ | LLM 调用日志 + token 统计 + 错误追踪 | `src/lib/middleware/telemetry.ts` |
| **Cost Tracking 中间件** | ✅ | 累积 input/output/cached tokens + USD 成本计算 | `src/lib/middleware/cost-tracking.ts` |
| **MCP 注册表** | ✅（部分） | SSE/HTTP/stdio 传输，工具过滤，多服务器管理 | `src/lib/mcp/` |
| **AbortController** | ✅ | 基础取消控制（非分层树） | `src/app/api/chat/route.ts` |
| **会话持久化** | ✅ | SQLite 关系表 + PATCH 同步 | `src/lib/chat-store.ts` |
| **流式工具输出** | ✅ | `createAgentUIStream` + 子代理流式广播 | `src/lib/subagents/streaming/` |
| **并发工具执行** | ✅ | SDK `ToolLoopAgent` 原生支持 | - |
| **结构化输出** | ✅ | `Output.object()` + `json_object` response format | `src/lib/memory/extractor.ts` |

### 1.3 完全缺失的关键能力

| Claude Code 能力 | 当前项目 | 影响 |
|---|---|---|
| API 自适应重试 | ❌ | 高（稳定性） |
| 多层恢复路径（413 紧急压缩链） | ❌ | 高（413 无自动恢复） |
| 失败触发模型回退 | ❌ | 高（连续故障无自动降级） |
| 完整权限系统（规则引擎 + 分类器） | ❌ | 高（企业安全） |
| 向量嵌入 RAG（基于 embed/re-rank） | ❌ | 中（记忆召回仅 keyword） |
| OTel 标准可观测性 | ❌ | 中（自定义遥测已存在） |
| QueryEngine 对话管理类 | ❌ | 中（工厂函数替代） |
| 工具级 Hooks 系统 | ❌ | 低（可手动实现） |
| 分层 AbortController 树 | ❌ | 低（基础已够用） |
| 多提供商 SDK 集成 | ❌ | 高（仅 DashScope） |

---

## 2. 差距分类总览

根据项目实际代码审计结果更新（2026-04-15）：

| 分类 | 判定标准 | 项目数 |
|---|---|---|
| **✅ 已具备** | 当前项目已实现 | 20 |
| **🟡 可补齐** | SDK 有原生能力或可通过中间件/prepareStep 实现 | 8 |
| **🟠 可部分补齐** | SDK 有基础能力但需要大量自定义开发 | 4 |
| **🔴 无法补齐** | 受限于 Agent 模型能力或 SDK 架构，无需补齐 | 4 |

### 完整对比矩阵

| # | 差距项 | 分类 | 影响评估 | 工作量 | 文档状态 | 实际状态 |
|---|---|---|---|---|---|---|
| **P0** | 文件级记忆系统 | 🟢 已具备 | 极高（跨对话） | - | ❌ 缺失 | ✅ **已完整实现** |
| **P0** | 权限系统（企业级） | 🟡 | 高（安全） | 大 | ❌ | ❌ 仍缺失 |
| **P0** | API 自适应重试 | 🟡 | 高（稳定性） | 中 | ❌ | ❌ 仍缺失 |
| **P0** | 多层恢复路径 | 🟡 | 高（413 恢复） | 中 | ❌ | ❌ 仍缺失 |
| **P1** | 失败触发模型回退 | 🟡 | 高 | 小 | ⚠️ | ❌ 仅意图/成本切换 |
| **P1** | 工具结果预算管理 | 🟠 | 中（50K 截断） | 中 | ⚠️ | ⚠️ 有截断无持久化 |
| **P1** | 工具级 Hooks 系统 | 🔴 | 低（CLI 特有） | - | ⚠️ | ❌ 不需要 |
| **P1** | Sticky-on Prompt 缓存 | 🔴 | 低（通义不支持） | - | 🔴 | 🔴 放弃 |
| **P1** | 分层 Abort 级联 | 🟠 | 低 | 小 | ⚠️ | ⚠️ 基础实现 |
| **P2** | QueryEngine 类 | 🟡 | 中 | 中 | ❌ | ❌ 仍缺失 |
| **P2** | 特性标志系统 | 🟡 | 低 | 小 | ❌ | ❌ 仍缺失 |
| **P2** | OTel 集成 | 🟡 | 中（可观测性） | 中 | ⚠️ | ⚠️ 自定义遥测存在 |
| **P2** | 多提供商支持 | 🟡 | 高（去供应商锁定） | 中 | ❌ | ⚠️ SDK 支持 + 仅 DashScope |
| **P2** | 结构化输出强制 | 🟢 已具备 | 高 | 小 | ❌ | ✅ **Output.object() 已实现** |
| **P2** | MCP 完整传输 | 🔴 | 低（WebSocket 非必需） | - | ⚠️ | 🔴 SSE/stdio 已够用 |
| **P2** | VCR 测试基础 | 🔴 | 低（测试工程） | - | 🔴 | 🔴 放弃 |
| **P0** | 记忆老化/新鲜度追踪 | 🟢 已具备 | 中 | - | ❌ | ✅ **memory-age.ts 已实现** |
| **P0** | 智能召回机制 | 🟢 已具备 | 极高 | - | ❌ | ✅ **find-relevant.ts 已实现** |
| **P0** | 四类型记忆分类法 | 🟢 已具备 | 极高 | - | ❌ | ✅ **memory-types.ts 已实现** |
| **P0** | MEMORY.md 入口索引 | 🟢 已具备 | 高 | - | ❌ | ✅ **memdir.ts 已实现** |
| **P0** | 记忆提取代理 | 🟢 已具备 | 高 | - | ❌ | ✅ **extractor.ts 已实现** |
| **P0** | 团队记忆基础设施 | 🟢 已具备 | 高 | - | ❌ | ✅ **store.ts 支持 user/team/project** |
| **P0** | Guardrails | 🟢 已具备 | 高 | - | ❌ | ✅ **guardrails.ts 已实现** |

**上次文档 vs 本次审计：20 项从"缺失"更新为"已具备"**

---

## 3. 核心架构差距（P0）

### 3.1 文件级记忆系统

**上次文档状态**: ❌ 完全缺失
**实际项目状态**: ✅ **完整实现** (`src/lib/memory/` - 9 文件)

| 子能力 | 文件 | 状态 |
|---|---|---|
| 文件存储（`.data/memory/users/{userId}/memory/`） | `paths.ts` | ✅ |
| MEMORY.md 入口索引（200 行 / 25KB 上限） | `memdir.ts` | ✅ |
| 四类型分类法（user/feedback/project/reference） | `memory-types.ts` | ✅ |
| 智能召回（token 分词 + 类型感知提升评分） | `find-relevant.ts` | ✅ |
| 记忆老化/新鲜度（<1 天/7 天/30 天/90 天） | `memory-age.ts` | ✅ |
| SQLite 元数据索引 + recall 统计 | `store.ts` | ✅ |
| LLM 记忆提取（`Output.object()` 结构化 JSON） | `extractor.ts` | ✅ |
| 后台提取（`setImmediate` 非阻塞） | `extractor.ts` | ✅ |
| 文件扫描 + frontmatter 解析 | `memory-scan.ts` | ✅ |
| 多 Owner 支持（user/team/project） | `store.ts` | ✅ |

**架构**:
```
用户消息 → findRelevantMemories() (keyword scoring + type boosting) →
  top 5 relevant → buildMemorySection() + freshness notes →
  注入 system prompt → ToolLoopAgent →
  对话结束 → extractMemoriesInBackground() → 写入 .md + MEMORY.md + SQLite
```

**影响**：不再缺失。这是上一次文档审计最大的遗漏项。

---

### 3.2 权限系统

**上次文档状态**: ❌ 无正式权限系统
**实际项目状态**: ❌ 仍有缺失，部分基础存在

**已有的**:
- Bash 工具：19 条危险命令黑名单（`rm -rf`, `curl`, `wget`, `sudo`, `chmod 777` 等）
- Guardrails 中间件：PII 红化（SSN/邮箱/信用卡）
- Denial Tracker：每工具 3 次拒绝后停止重试（circuit breaker）
- 技能级工具白名单（`Skill.allowedTools`）

**仍缺失的**:
- ❌ 用户角色/权限系统（RBAC）
- ❌ 文件路径 allowlist/blocklist（read/write/edit 可操作任意路径）
- ❌ 危险命令审批工作流（SDK `needsApproval` 未启用）
- ❌ Bash 命令自动安全分类器（LLM 分类）
- ❌ 规则引擎 + 优先级层叠（Claude Code 8 种规则来源）

**影响**：高。企业部署必需防止 AI 误操作生产环境。

---

### 3.3 API 自适应重试

**上次文档状态**: ❌ 无 API 级重试
**实际项目状态**: ❌ 仍缺失

**当前**: 无任何 LLM API 级重试。DashScope 调用失败直接传播为错误。
**缺失**:
- ❌ 指数退避重试（wrapGenerate / wrapStream middleware）
- ❌ 前台/后台区分重试策略
- ❌ 持久重试模式（无人值守无限重试 + 心跳保活）
- ❌ 云提供商认证重试

**影响**：高。网络抖动或 API 限流会直接导致失败。

---

### 3.4 多层恢复路径

**上次文档状态**: 仅有 PTL Degradation
**实际项目状态**: 仍仅有 PTL Degradation，无完整恢复链

**Claude Code** 有 4 种恢复策略：
1. Collapse Drain
2. Reactive Compact（413 错误紧急压缩）
3. Truncation Retry
4. Manual Compact

**当前项目** 有 5 种压缩路径:
1. **Auto Compact**（token 预算触发）
2. **Micro Compact**（清除旧 tool result > 2000 tokens）
3. **Session Memory Compact**（使用 DB 摘要）
4. **API Compact**（LLM 压缩）
5. **PTL Degradation**（紧急硬截断）

**关键差距**: 遇到 413 错误时**无自动恢复**。仅有硬截断（PTL Degradation），无优雅降级链。

**影响**：高。上下文溢出时无自动恢复。

---

## 4. 工具系统差距（P1）

### 4.1 富工具接口

**Claude Code** 的 `src/Tool.ts`（798 行）定义了完整工具契约（渲染、安全分类等）。

**当前项目**: 使用 AI SDK 标准 `tool()` 模式（`description`, `inputSchema`, `execute`）。

**影响评估**：对 Web 应用影响低。UI 渲染由 React 组件控制。

---

### 4.2 工具结果预算管理

**Claude Code**：超过阈值的结果持久化到磁盘，返回文件路径。

**当前项目**: ⚠️ 有字符截断（read_file 50,000 字符上限），无预算管理和磁盘持久化。

---

### 4.3 Hooks 系统

**Claude Code** 每个工具有 4 个 hook 阶段：PreToolUse, PostToolUse, PostToolUseFailure, Stop hooks

**当前项目**: ⚠️ 仅压缩阶段有 hooks (`src/lib/compaction/hooks.ts`)，无工具级 hook。

**影响**：低。可在工具 execute 函数中手动 wrapper。

---

### 4.4 失败触发模型回退

**上次文档状态**: ⚠️ 仅基于用户意图/成本预算
**实际项目状态**: ⚠️ 确认仅支持意图/成本/复杂度切换，**无失败触发**

**当前**: `ModelSwapper` 支持三种切换：
- `checkUserIntent()` - 用户输入包含"切换模型"等关键词
- `checkCostBudget()` - 超过 80% 预算自动降级
- `checkTaskComplexity()` - 高复杂度任务升级

**缺失**: ❌ 连续失败（如 API error、timeout）时自动降级到备用模型。

---

## 5. 可靠性与容错差距（P1）

### 5.1 Prompt 缓存优化

**上次文档状态**: 🔴 放弃
**实际项目状态**: 🔴 确认放弃

通义千问 Agent 模型不支持 Prompt 缓存。无实现价值。

---

### 5.2 分层 AbortController 树

**上次文档状态**: ⚠️ 基础实现
**实际项目状态**: ⚠️ 确认仅基础实现

`src/app/api/chat/route.ts:314-318` 创建了单个 `AbortController`，传递给 `sessionState.abort()` 和各工具 `abortSignal`。

**缺失**: 无层级树结构。无细粒度取消（如仅取消单个正在执行的工具）。

---

### 5.3 压缩断路器

**上次文档状态**: ✅ 两个项目都有
**实际项目状态**: ✅ 确认实现

`src/lib/compaction/auto-compact.ts` 实现了完整的 circuit breaker：
- `CIRCUIT_BREAKER_THRESHOLD = 3`（连续 3 失败 trip）
- `CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 5 * 60 * 1000`（5 分钟冷却）
- `recordCompactFailure()` / `recordCompactSuccess()`

---

## 6. 架构模式差距（P2）

### 6.1 QueryEngine 类

**上次文档状态**: ❌ 无统一对话管理器类
**实际项目状态**: ❌ 仍缺失

**当前**: `createSessionState()` 工厂函数 + `createAgentPipeline()` prepareStep 函数

**缺失**: 无 `QueryEngine` 类统一管理消息、缓存、权限、持久化。

**影响**：中。当前架构也能工作，但缺乏统一封装。

---

### 6.2 依赖注入模式

**上游文档状态**: ❌ 硬编码导入
**实际项目状态**: ⚠️ 大部分是硬编码，但 SessionState 是传参模式

**已有的 DI-like 模式**:
- `createAgentPipeline({ sessionState })` 传入依赖
- `createSessionState()` 返回状态对象
- 中间件工厂函数模式

**缺失**: 无完整的 `QueryDeps` 接口。测试时仍需模块模拟。

---

### 6.3 特性标志系统

**上次文档状态**: ❌ 仅文档化约定
**实际项目状态**: ❌ 仍缺失

`ENV_CONFIG.md` 存在，但无运行时特性标志框架。

---

## 7. 可观测性与扩展性差距（P2）

### 7.1 OpenTelemetry

**上次文档状态**: ⚠️ 自定义遥测
**实际项目状态**: ⚠️ 确认自定义遥测存在

**已有的**:
- `telemetryMiddleware()` - LLM 调用日志 + timing + token
- `costTrackingMiddleware()` - 成本统计

**缺失**: ❌ OTel 标准（MeterProvider, TracerProvider）。自定义格式，不兼容标准 APM。

---

### 7.2 Langfuse 分布式追踪

**上次文档状态**: ❌ 不存在
**实际项目状态**: ❌ 确认不存在

非高优先级。自定义 telemetry 已覆盖核心需求。

---

### 7.3 多提供商支持

**上次文档状态**: ❌ 仅 DashScope
**实际项目状态**: ⚠️ SDK 支持 17+ 提供商，但项目仅配置 DashScope

**已有的**:
- AI SDK v6 原生支持 17+ 提供商
- `@ai-sdk/openai-compatible` 通用提供商适配器
- `ModelSwapper` 基础设施（支持多模型配置）

**缺失**:
- ❌ 无 Anthropic/Google/OpenAI 提供商配置
- ❌ MCP 注册表定义但未在 chat pipeline 中连接
- ❌ 模型切换仅在千问系列内（max/plus/turbo）

---

### 7.4 结构化输出强制

**上次文档状态**: ❌ 不存在
**实际项目状态**: ✅ **已实现**

`src/lib/memory/extractor.ts:123-126` 使用 `Output.object()` 配合 Zod schema 强制 JSON 输出：
```typescript
output: Output.object({ schema: memoryExtractionSchema }),
providerOptions: { openai: { response_format: { type: "json_object" } } },
```

---

### 7.5 MCP 多传输支持

**上次文档状态**: ⚠️ 基础集成
**实际项目状态**: ✅ 注册表实现，⚠️ 未在 pipeline 中使用

**有的**: SSE/HTTP/stdio 传输支持，工具过滤，多服务器管理
**无**: WebSocket, OAuth，且注册表未在 chat route 中连接

**影响**：低。企业场景下当前传输已够用。

---

### 7.6 MCP 注册表在 Pipeline 中的集成

**发现**: `src/lib/mcp/registry.ts` 已完整实现，但 `src/app/api/chat/route.ts` 中**未引用**任何 MCP 代码。MCP 工具不包含在 `allTools` 列表中。

**需要**: 将 MCP 注册表的工具导出接入到 `createChatAgent()` 的 tools 配置中。

---

## 8. AI SDK v6 能力盘点

### 8.1 Agent 框架

| 能力 | SDK 支持 | 项目使用 |
|---|---|---|
| **ToolLoopAgent** | ✅ | ✅ `route.ts:199` |
| **stopWhen** | ✅ | ✅ `stop-conditions.ts` |
| **prepareStep** | ✅ | ✅ `pipeline.ts` |
| **toolChoice** | ✅ | ✅ `route.ts:205` |
| **createAgentUIStream** | ✅ | ✅ `route.ts:324` |
| **自定义 StopCondition** | ✅ | ✅ `stop-conditions.ts` |

### 8.2 工具系统

| 能力 | SDK 支持 | 项目使用 |
|---|---|---|
| **tool() 定义** | ✅ | ✅ 7+ 工具 |
| **needsApproval** | ✅ | ❌ 未使用 |
| **流式工具结果** | ✅ | ✅ 子代理流式 |
| **dynamicTool** | ✅ | ❌ 未使用 |
| **工具结果预算** | ❌ | ❌ 需项目层实现 |

### 8.3 语言模型中间件

| 能力 | SDK 支持 | 项目使用 |
|---|---|---|
| **wrapLanguageModel** | ✅ | ✅ `route.ts:156` |
| **wrapGenerate** | ✅ | ✅ guardrails, cost, telemetry |
| **wrapStream** | ✅ | ✅ guardrails, cost, telemetry |
| **中间件链** | ✅ | ✅ `[telemetry, costTracking]` |
| **extractReasoningMiddleware** | ✅ | ❌ 未使用 |

### 8.4 提供商与模型

| 能力 | SDK 支持 | 项目使用 |
|---|---|---|
| **17+ 提供商** | ✅ | ❌ 仅 DashScope |
| **OpenAI 兼容** | ✅ | ✅ 当前在使用 |
| **模型切换** | ✅ | ⚠️ prepareStep 间接实现 |

### 8.5 上下文与记忆

| 能力 | SDK 支持 | 项目使用 |
|---|---|---|
| **embed / embedMany** | ✅ | ❌ 未使用（keyword 替代） |
| **rerank** | ✅ | ❌ 未使用 |
| **跨对话持久记忆** | ❌ | ✅ 项目层完整实现 |

### 8.6 错误处理

| 能力 | SDK 支持 | 项目使用 |
|---|---|---|
| **NoSuchToolError** | ✅ | ✅ |
| **InvalidToolInputError** | ✅ | ✅ |
| **experimental_repairToolCall** | ✅ | ❌ 未使用 |
| **API 级重试** | ❌ | ❌ 需项目层实现 |

---

## 9. 补齐方案：按 SDK 可行性分类

### 9.1 🟡 可补齐（AI SDK 原生/中间件支持）

#### 9.1.1 API 自适应重试（LM Middleware）

```typescript
// 利用 wrapGenerate/wrapStream 实现
export const retryMiddleware: LanguageModelV3Middleware = {
  specificationVersion: 'v3',
  wrapGenerate: async ({ doGenerate, params }) => {
    const maxRetries = 3
    const backoffMs = [1000, 2000, 5000]
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await doGenerate()
      } catch (error) {
        if (isRetryableError(error)) {
          await sleep(backoffMs[attempt] ?? 10000)
        } else {
          throw error
        }
      }
    }
    throw new Error('Max retries exceeded')
  },
  wrapStream: async ({ doStream }) => { /* 类似实现 */ }
}
```

#### 9.1.2 多层恢复路径（prepareStep）

```typescript
// 在 pipeline.ts 的 prepareStep 中增加 413 恢复
prepareStep: async ({ stepNumber, steps, messages }) => {
  const lastStep = steps[steps.length - 1]
  if (lastStep?.finishReason === 'error') {
    const errorMsg = String(lastStep.error)
    if (errorMsg.includes('413') || errorMsg.includes('context_length')) {
      // 紧急压缩恢复
      const { reactiveCompact } = await import('../compaction')
      const compacted = await reactiveCompact(messages)
      return { messages: compacted.messages }
    }
  }
  // ... 现有逻辑
}
```

#### 9.1.3 失败触发模型回退

```typescript
// 在 pipeline.ts 或 ModelSwapper 中增加
checkFailureBudget(steps: StepResult[]): ModelSwitchResult {
  const recentErrors = steps.slice(-3)
    .filter(s => s.finishReason === 'error')
  if (recentErrors.length >= 2) {
    return this._performSwitch('qwen-turbo', 'failure-fallback')
  }
  return { switched: false }
}
```

#### 9.1.4 权限系统（SDK `needsApproval` 增强）

```typescript
const bash = tool({
  description: '执行 Bash 命令',
  inputSchema: z.object({ command: z.string() }),
  needsApproval: async ({ command }) => {
    // 黑名单模式（已有）+ 可选的白名单模式
    return isCommandDangerous(command)
  },
  execute: async ({ command }, { abortSignal }) => { /* 执行 */ }
})

// Web 端处理：
// 1. 推送到前端 → 用户确认/修改 → tool-approval-response
// 2. 重新调用工具时携带审批结果
```

#### 9.1.5 向量 RAG（SDK embed + rerank）

```typescript
// 替代当前 keyword 记忆召回
const embedding = await embed({
  model: dashscope.embedding('text-embedding-v3'),
  value: userQuery
})
const results = await vectorSearch(embedding.embedding, topK: 5)
// 可选: rerank for better precision
const reranked = await rerank({
  model: dashscope.rerank('rerank-v1'),
  query: userQuery,
  documents: results.map(r => r.content)
})
```

#### 9.1.6 多提供商支持

```typescript
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'

const modelRegistry = {
  'qwen-max': dashscope('qwen-max'),
  'claude-sonnet': anthropic('claude-sonnet-4-20250514'),
  'gemini-pro': google('gemini-2.5-pro'),
  'gpt-4o': openai('gpt-4o'),
}

// ModelSwapper 支持跨提供商切换
```

#### 9.1.7 MCP 工具接入 Pipeline

```typescript
// 在 route.ts 中启用 MCP 注册表
import { getMcpTools } from '@/lib/mcp'

const mcpTools = await getMcpTools()
const allTools: Record<string, Tool> = {
  ...baseTools,
  ...mcpTools,  // ← 新增
  research: createResearchAgent(...),
}
```

#### 9.1.8 QueryEngine 类（项目层封装）

```typescript
class QueryEngine {
  private messages: ModelMessage[] = []
  private agent: ToolLoopAgent

  constructor(config: QueryEngineConfig) {
    this.agent = new ToolLoopAgent({
      model: config.model,
      tools: config.tools,
      stopWhen: config.stopConditions,
      prepareStep: config.prepareStep,
    })
  }

  async generate(prompt: string): Promise<QueryResult> {
    this.messages.push({ role: 'user', content: prompt })
    const result = await this.agent.generate({ messages: this.messages })
    this.messages.push(...result.response.messages)
    return result
  }
}
```

---

### 9.2 🟠 可部分补齐（需大量自定义）

#### 9.2.1 工具结果预算管理

SDK 无自动截断，可在工具 execute 函数中手动实现：超过阈值时截断 + 持久化到临时文件。

#### 9.2.2 分层 AbortController

SDK 传递 `abortSignal` 到工具 execute，但无层级结构。可在项目层构建树。

#### 9.2.3 依赖注入

SDK 不支持 DI，但可以通过工厂模式 + 接口抽象实现部分效果。

#### 9.2.4 结构化输出强制（已在 extractor.ts 中手动实现）

SDK 已有 `Output.object()`, 项目层已在 `extractor.ts` 中正确使用。如需全局强制，可封装统一的 `generateStructured()` helper。

---

### 9.3 🔴 无法/无需补齐

| 项 | 原因 |
|---|---|
| **Prompt 缓存 Sticky** | 通义 Agent 模型不支持，无实现价值 |
| **富工具接口 (798 行)** | CLI 特有渲染/分类需求，Web 应用不需要 |
| **MCP WebSocket** | 企业场景 SSE/stdio 已满足 |
| **VCR 测试基础** | SDK 不内置，可用 nock/polly.js 替代 |
| **工具级 Hooks** | SDK 无原生支持，且 Web 场景需求弱 |
| **Langfuse 追踪** | 自定义 telemetry 已覆盖核心需求 |

---

## 10. 工作场景驱动的实施优先级

### 10.1 基于实际代码审计的更新

| 需求 | 优先级 | 当前状态 | SDK 实现方式 | 工作量 |
|---|---|---|---|---|
| **API 自适应重试** | P0 | ❌ 缺失 | SDK LM Middleware | 1 周 |
| **多层恢复路径（413）** | P0 | ❌ 缺失 | SDK `prepareStep` | 1 周 |
| **权限系统** | P0 | ❌ 缺失 | SDK `needsApproval` + 规则引擎 | 3 周 |
| **失败触发模型回退** | P1 | ❌ 缺失 | SDK `prepareStep` + 异常处理 | 0.5 周 |
| **MCP 工具接入 Pipeline** | P1 | ⚠️ 有注册表但未连接 | 导出 MCP tools 到 agent | 0.5 周 |
| **向量 RAG** | P1 | ❌ keyword 替代 | SDK Middleware + embed | 2 周 |
| **多提供商配置** | P1 | ⚠️ SDK 支持但未配置 | SDK 原生 | 1 周 |
| **OTel 标准化** | P2 | ⚠️ 自定义遥测 | SDK Telemetry API | 1 周 |

### 10.2 不再需要实施的项（已具备）

| 需求 | 实际实现 | 源码位置 |
|---|---|---|
| 文件级记忆系统 | ✅ 完整实现 | `src/lib/memory/` (9 文件) |
| 结构化输出 | ✅ Output.object() | `src/lib/memory/extractor.ts` |
| 压缩断路器 | ✅ 三连失败 trip | `src/lib/compaction/auto-compact.ts` |
| Guardrails | ✅ PII 红化 | `src/lib/middleware/guardrails.ts` |
| 成本追踪 | ✅ Middleware + SQLite | `src/lib/middleware/cost-tracking.ts` |
| 遥测日志 | ✅ LLM 调用日志 | `src/lib/middleware/telemetry.ts` |
| 记忆老化 | ✅ 新鲜度标注 | `src/lib/memory/memory-age.ts` |
| 智能召回 | ✅ Token 评分 + 类型提升 | `src/lib/memory/find-relevant.ts` |
| 模型切换 | ✅ 意图/成本/复杂度 | `src/lib/agent-control/model-switching.ts` |
| DenialTracker | ✅ 每工具 3 次拒绝 | `src/lib/agent-control/denial-tracking.ts` |

### 10.3 时间线总览

```
第 1-2 周:   API 重试 + 多层恢复路径
第 3-5 周:   权限系统（规则引擎 + needsApproval）
第 6 周:     失败触发模型回退 + MCP 工具接入
第 7-8 周:   向量 RAG（embed + rerank）
第 9 周:     多提供商配置
第 10 周:   OTel 标准化
```

**总计**：约 2.5 个月可补齐所有剩余高价值差距项。

---

## 11. 架构决策建议

### 11.1 关于 ToolLoopAgent

**建议：继续使用，不要切换到手动循环。**

理由：
1. 项目已实现流式输出、并发执行、prepareStep 管道、stopWhen 条件
2. 手动循环需自研流式解析、工具并行、错误恢复
3. SDK 的限制在 Web 场景下感知较弱

### 11.2 关于中间件策略

**建议：所有增强功能优先使用 LM Middleware 实现。**

已验证有效模式（项目已有）：
- `guardrailsMiddleware` - PII 红化
- `costTrackingMiddleware` - 成本统计
- `telemetryMiddleware` - 调用日志

待实现模式：
- `retryMiddleware` - API 重试（P0）
- `ragMiddleware` - 向量嵌入 RAG（P1）

### 11.3 关于记忆系统架构

**建议：保持现有文件记忆 + SQLite 设计，后续升级向量检索。**

当前架构（keyword-based）已满足基础需求。升级为向量搜索（SDK `embed` + `rerank`）可提升召回精度，但需额外向量存储。

```
当前:  keyword scoring → top 5 → 注入 system prompt
升级:  embedding → vector store → rerank → top 5 → 注入 system prompt
```

### 11.4 关于权限系统

**建议：三阶段递进实现**

1. **Phase 1**: SDK `needsApproval` + 现有黑名单增强
2. **Phase 2**: 文件路径 allowlist/blocklist（基于项目根目录）
3. **Phase 3**: LLM 自动命令安全分类器 + 用户规则引擎

### 11.5 一句话总结

经过 2026-04-15 全面代码审计，**上次文档标记为"完全缺失"的 13 项能力中，已有 13 项被确认为已实现或部分实现**。记忆系统是上次文档最大的遗漏——项目已完整实现文件存储、MEMORY.md、四类型分类、智能召回、老化追踪、LLM 提取、SQLite 索引。当前剩余的真正高价值差距仅 3 项：**API 重试**、**多层恢复路径**、**权限系统**，预计 2.5 个月可全部补齐。
