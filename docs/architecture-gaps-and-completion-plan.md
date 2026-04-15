# Claude Code 差距分析与 AI SDK v6 补齐方案

> 基于 Claude Code 源码审计、Vercel AI SDK v6 文档、当前项目现状的三向对比分析

## 文档信息

- **创建日期**: 2026-04-15
- **参考来源**:
  - [Claude Code 源码](https://github.com/claude-code-best/claude-code) (`src/` 完整审计)
  - [AI SDK v6 官方文档](https://ai-sdk.dev/docs)
  - 当前项目 (`E:\thething/src/`)
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
| 框架 | Vercel AI SDK v6 (`ai` 包) |
| LLM 提供商 | DashScope（通义千问，OpenAI 兼容接口） |
| 持久化 | SQLite (`better-sqlite3`) at `.data/chat.db` |
| 部署模式 | 企业级私有化部署，中心化云服务器/内部服务器 |

### 1.2 当前已有能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 四层上下文压缩 | ✅ | micro, session-memory, PTL, API |
| 压缩断路器 | ✅ | 连续 3 失败 trip |
| 动态系统提示词 | ✅ | Section 工厂 + 缓存 |
| CLAUDE.md 加载 | ✅ | 用户级 + 项目级 |
| Token 预算追踪 | ✅ | `token-budget.ts` |
| 成本追踪 | ✅ | 按模型定价表 + SQLite |
| Denial Tracking | ✅ | 每工具 3 次拒绝 |
| 子代理框架 | ✅ | 7 代理 + 路由 |
| 技能系统 | ✅ | 9 技能，关键词 + 路径条件激活 |
| MCP 集成 | ✅ | SSE/HTTP/stdio |
| AbortController | ✅ | 基础取消控制 |
| 会话持久化 | ✅ | SQLite 关系表 |
| Prompt 缓存策略 | ✅ | `cacheStrategy` 系统 |
| 流式工具输出 | ✅ | 工具流式执行并推送到前端 |
| 并发工具执行 | ✅ | 支持多工具并行执行 |

### 1.3 完全缺失的关键能力

| Claude Code 能力 | 当前项目 |
|---|---|
| `memdir/` 模块（9 个文件，1795 行） | ❌ |
| `MEMORY.md` 入口索引机制 | ❌ |
| 四类型记忆分类法 | ❌ |
| 智能召回机制 | ❌ |
| 记忆老化/新鲜度追踪 | ❌ |
| 权限系统（规则引擎 + 分类器） | ❌ |
| API 自适应重试 | ❌ |
| 多层恢复路径 | ❌ |
| 记忆漂移防御 | ❌ |
| 团队记忆系统 | ❌ |
| 背景提取代理 | ❌ |
| QueryEngine 对话管理类 | ❌ |
| 多提供商支持 | ❌ |
| 结构化输出强制 | ❌ |

---

## 2. 差距分类总览

根据 AI SDK v6 的能力边界和项目实际情况，将差距分为三类：

| 分类 | 判定标准 | 项目数 |
|---|---|---|
| **🟢 已具备** | 当前项目已实现 | 15 |
| **🟡 可补齐** | SDK 有原生能力或可通过中间件/prepareStep 实现 | 10 |
| **🟠 可部分补齐** | SDK 有基础能力但需要大量自定义开发 | 4 |
| **🔴 无法补齐** | 受限于 Agent 模型能力或 SDK 架构，无法实现 | 5 |

### 完整对比矩阵

| # | 差距项 | 分类 | 影响评估 | 工作量 |
|---|---|---|---|---|
| **P0** | 文件级记忆系统 | 🟡 | 极高（跨对话） | 中 |
| **P0** | 权限系统（企业级） | 🟡 | 高（安全） | 大 |
| **P0** | API 自适应重试 | 🟡 | 高（稳定性） | 中 |
| **P0** | 多层恢复路径 | 🟡 | 高（413 恢复） | 中 |
| **P1** | 失败触发模型回退 | 🟡 | 高 | 小 |
| **P1** | 工具结果预算管理 | 🟠 | 中 | 中 |
| **P1** | 工具级 Hooks 系统 | 🟠 | 中 | 中 |
| **P1** | Sticky-on Prompt 缓存 | 🔴 | 低（通义不支持） | - |
| **P1** | 分层 Abort 级联 | 🟠 | 中 | 小 |
| **P2** | 依赖注入模式 | 🟠 | 低（测试可维护性） | 中 |
| **P2** | QueryEngine 类 | 🟡 | 中 | 中 |
| **P2** | 特性标志系统 | 🟡 | 低 | 小 |
| **P2** | OTel 集成 | 🟡 | 中（可观测性） | 中 |
| **P2** | Langfuse 追踪 | 🟡 | 低 | 小 |
| **P2** | 多提供商支持 | 🟡 | 高（去供应商锁定） | 中 |
| **P2** | 结构化输出强制 | 🟡 | 高 | 小 |
| **P2** | MCP 完整传输 | 🔴 | 低（WebSocket 非必需） | - |
| **P2** | VCR 测试基础 | 🔴 | 低（测试工程） | - |
| **P1** | 富工具接口（798 行） | 🔴 | 低（CLI 特有） | - |
| **P1** | Prompt 缓存优化 | 🔴 | 低（Agent 模型限制） | - |

---

## 3. 核心架构差距（P0）

### 3.1 文件级记忆系统

**Claude Code 实现** (`src/memdir/` - 9 文件, 1795 行):

```
~/.claude/projects/<git-root>/memory/
├── MEMORY.md         ← 入口索引（200 行 / 25KB 上限）
├── user_role.md      ← 用户记忆
├── feedback_testing  ← 反馈记忆
├── project_*.md      ← 项目记忆
└── reference_*.md    ← 参考记忆
```

四类型分类法：
| 类型 | 存储内容 | 典型触发 |
|---|---|---|
| **user** | 用户角色、偏好、技术背景 | "我是数据科学家" |
| **feedback** | 用户对 AI 行为的纠正和确认 | "别 mock 数据库" |
| **project** | 非代码可推导的项目上下文 | "合并冻结从周四开始" |
| **reference** | 外部系统指针 | "pipeline bugs 在 Linear" |

智能召回机制：用户消息 → Sonnet 侧查询 → 筛选 ≤5 条相关记忆 → 注入上下文

**当前项目**：❌ 完全缺失。无 `MEMORY.md`、无记忆目录、无分类法、无召回机制。对话重启后丢失所有上下文。

**影响**：极严重。企业场景下，跨对话知识共享是核心需求。

---

### 3.2 权限系统

**Claude Code 实现** (`src/types/permissions.ts` + `src/utils/permissions/` - 27 文件):

```typescript
type PermissionMode = 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan' | 'auto' | 'bubble'
type PermissionBehavior = 'allow' | 'deny' | 'ask'
type PermissionRuleSource = 'userSettings' | 'projectSettings' | 'localSettings' | 'flagSettings' | 'policySettings' | 'cliArg' | 'command' | 'session'
```

8 种规则来源，优先级层叠。LLM 自动模式分类器（XML 两阶段：fast + thinking）分析 Bash 命令安全性。

**当前项目**：❌ 无正式权限系统。仅子代理有 `allowedTools` / `disallowedTools` 简单白黑名单，Bash 工具有硬编码危险命令黑名单。

**影响**：高。企业部署必需防止 AI 误操作生产环境。

---

### 3.3 API 自适应重试

**Claude Code 实现** (`src/services/api/withRetry.ts` - 822 行):
- 前台/后台区分重试策略
- 持久重试模式（无人值守无限重试 + 心跳保活）
- 模型回退（连续 3 次 529 → `FallbackTriggeredError`）
- 云提供商认证重试（AWS Bedrock / GCP Vertex OAuth）
- Max tokens 溢出恢复

**当前项目**：❌ 无 API 级重试。任务层有 `retryTask`（重置状态，非退避重试）。

---

### 3.4 多层恢复路径

**Claude Code** 有 4 种上下文溢出恢复策略：
1. Collapse Drain
2. Reactive Compact（413 错误紧急压缩）
3. Truncation Retry
4. Manual Compact

**当前项目**：仅有 PTL Degradation（紧急硬截断），无完整恢复链。遇到 413 错误时无自动恢复。

---

## 4. 工具系统差距（P1）

### 4.1 富工具接口

**Claude Code** 的 `src/Tool.ts`（798 行）定义了完整工具契约：

```typescript
export type Tool<Input, Output, P> = {
  // 安全
  isEnabled(): boolean
  isConcurrencySafe(input): boolean
  isReadOnly(input): boolean
  isDestructive?(input): boolean
  validateInput?(input, context): Promise<ValidationResult>
  checkPermissions(input, context): Promise<PermissionResult>

  // UI 渲染
  renderToolUseMessage(input, options): ReactNode
  renderToolResultMessage(content, options): ReactNode
  renderToolUseProgressMessage(progress, options): ReactNode
  renderGroupedToolUse?(toolUses, options): ReactNode | null

  // 安全与分类
  toAutoClassifierInput(input): unknown
  isSearchOrReadCommand?(input): { isSearch, isRead, isList }

  // 高级
  maxResultSizeChars: number
  interruptBehavior?(): 'cancel' | 'block'
}
```

**当前项目**：✅ 工具有流式输出和并发执行能力，但使用 AI SDK 标准 `tool()` 模式（`description`, `inputSchema`, `execute`），无上述高级元数据。

**影响评估**：对 Web 应用影响低。UI 渲染由 React 组件控制，不需要工具自带渲染逻辑。安全分类可通过权限系统独立实现。

---

### 4.2 工具结果预算管理

**Claude Code**：超过 `maxResultSizeChars` 的结果持久化到磁盘，返回文件路径。

**当前项目**：⚠️ 有字符截断（如 50,000 字符），无预算管理和磁盘持久化。

---

### 4.3 Hooks 系统

**Claude Code** 每个工具有 4 个 hook 阶段：PreToolUse, PostToolUse, PostToolUseFailure, Stop hooks

**当前项目**：⚠️ `src/lib/compaction/hooks.ts` 仅限压缩阶段，无工具级 hook。

---

## 5. 可靠性与容错差距（P1）

### 5.1 失败触发模型回退

**Claude Code**：连续失败 → 自动切换备用模型。

**当前项目**：⚠️ `model-switching.ts` 仅基于用户意图和成本预算（80% 时降级），无失败触发的自动回退。

---

### 5.2 Prompt 缓存优化

**Claude Code**：Sticky-on Beta Headers，整个会话锁定避免缓存失效。

**当前项目**：⚠️ 有 `cacheStrategy` 系统（`static`/`session`/`dynamic`），无 sticky 锁定。

**重要说明**：当前项目使用的是通义千问 Agent 模型，**该模型不支持 Prompt 缓存功能**。此项即使实现也无实际收益，可暂缓。

---

### 5.3 分层 AbortController 树

**Claude Code**：根 → 兄弟 → 单工具，支持细粒度取消和错误级联。

**当前项目**：⚠️ `api/chat/route.ts`、`subagents/`、`bash.ts` 有基础 `AbortController`，无分层树和级联。

---

### 5.4 压缩断路器

✅ **两个项目都有**。`src/lib/compaction/auto-compact.ts` 已实现：`circuitBreakers` Map 追踪连续失败，TRIPPED 后带 `resetTimeout`。

---

## 6. 架构模式差距（P2）

### 6.1 异步迭代器控制流

**Claude Code** `query.ts` 使用 `AsyncGenerator`，支持渐进式渲染和自然背压。

**当前项目**：使用 AI SDK `ToolLoopAgent`，控制流被 SDK 抽象。这不是缺点（SDK 封装了复杂度），但失去精细控制。

---

### 6.2 依赖注入模式

**Claude Code**：`QueryDeps` 接口支持测试注入 fakes。

**当前项目**：❌ 硬编码导入，测试时需模块模拟。

---

### 6.3 QueryEngine 类

**Claude Code**：1320 行的 `QueryEngine` 类，每个对话一个实例，统一管理消息、缓存、权限、持久化。

**当前项目**：❌ 无统一对话管理器类。`createSessionState()` 是工厂函数返回状态对象，`createAgentPipeline()` 返回 prepareStep 函数。

---

### 6.4 特性标志系统

**Claude Code**：Bun `bun:bundle` 编译期 tree-shaking。

**当前项目**：❌ `ENV_CONFIG.md` 仅文档化约定，无实际框架。

---

## 7. 可观测性与扩展性差距（P2）

### 7.1 OpenTelemetry

**Claude Code**：完整 OTel 栈（MeterProvider, LoggerProvider, BasicTracerProvider）。

**当前项目**：⚠️ 自定义内存遥测（`src/lib/middleware/telemetry.ts`），追踪 token 和成本，无 OTel 标准。

---

### 7.2 Langfuse 分布式追踪

**Claude Code**：可选 Langfuse 集成。

**当前项目**：❌ 不存在。

---

### 7.3 多提供商支持

**Claude Code** API 层（3483 行）支持 7 提供商。

**当前项目**：❌ 仅 DashScope。`modelSwapper` 仅切换千问系列模型。

---

### 7.4 结构化输出强制

**Claude Code**：JSON schema 验证 + 重试限制。

**当前项目**：❌ 工具校验输入，但无模型输出的结构化强制。

---

### 7.5 MCP 多传输支持

**Claude Code** MCP 客户端（3350 行）支持 Stdio/SSE/StreamableHTTP/WebSocket。

**当前项目**：⚠️ 有基础 MCP 集成（SSE/HTTP/stdio），无 WebSocket 和 OAuth。

---

### 7.6 会话持久化

**Claude Code**：JSONL 转录文件，后台无阻塞写入。

**当前项目**：⚠️ SQLite 关系表（`conversations`, `messages`, `summaries`），更结构化但缺乏日志级可追溯性。

---

## 8. AI SDK v6 能力盘点

### 8.1 Agent 框架

| 能力 | SDK 支持 | 说明 |
|---|---|---|
| **ToolLoopAgent** | ✅ | 内置 agentic loop |
| **stopWhen** | ✅ | `stepCountIs()`, `hasToolCall()`, `isLoopFinished()`, 自定义 |
| **prepareStep** | ✅ | 每步前回调：动态模型、工具选择、消息修改 |
| **toolChoice** | ✅ | `auto` / `required` / `none` / 指定工具 |
| **自定义 StopCondition** | ✅ | `({ steps }) => boolean` |

### 8.2 工具系统

| 能力 | SDK 支持 | 说明 |
|---|---|---|
| **tool() 定义** | ✅ | `description`, `inputSchema` (Zod), `execute`, `strict` |
| **工具执行审批** | ✅ | `needsApproval` + `tool-approval-request` |
| **工具生命周期 Hooks** | ✅ | `onInputStart`, `onInputDelta`, `onInputAvailable` |
| **工具执行回调** | ✅ | `experimental_onToolCallStart/Finish` |
| **流式工具结果** | ✅ | `execute` 返回 `AsyncIterable` |
| **多模态工具结果** | ⚠️ | 仅部分提供商支持 |
| **动态工具** | ✅ | `dynamicTool` 运行时加载 |
| **工具结果预算** | ❌ | 需项目层实现 |
| **富工具接口** | ❌ | SDK 不提供 |

### 8.3 语言模型中间件

| 能力 | SDK 支持 | 说明 |
|---|---|---|
| **wrapLanguageModel** | ✅ | 拦截/修改 LLM 调用 |
| **transformParams** | ✅ | 修改请求参数（RAG 模式） |
| **wrapGenerate** | ✅ | 包装 `doGenerate` |
| **wrapStream** | ✅ | 包装 `doStream` |
| **extractReasoningMiddleware** | ✅ | 提取 reasoning 标签 |
| **extractJsonMiddleware** | ✅ | 提取 JSON |
| **中间件链** | ✅ | 多个中间件叠加 |

### 8.4 提供商与模型

| 能力 | SDK 支持 | 说明 |
|---|---|---|
| **多提供商** | ✅ | 17+ 提供商 |
| **OpenAI 兼容** | ✅ | `@ai-sdk/openai-compatible`（当前项目在用） |
| **自定义提供商** | ✅ | `createOpenAICompatible()` |
| **模型切换** | ✅ | `prepareStep` 动态切换 |
| **Prompt 缓存** | ⚠️ | 仅部分提供商支持 |

### 8.5 上下文与记忆

| 能力 | SDK 支持 | 说明 |
|---|---|---|
| **Agents Memory** | ✅ | `Memory` 类 |
| **embed / embedMany** | ✅ | 生成嵌入向量 |
| **rerank** | ✅ | 重排序 |
| **RAG 模式** | ✅ | 文档有完整教程 |
| **跨对话持久记忆** | ❌ | 需项目层实现 |

### 8.6 可观测性

| 能力 | SDK 支持 | 说明 |
|---|---|---|
| **Telemetry API** | ✅ | OpenTelemetry 兼容 |
| **onStepFinish** | ✅ | 记录每步信息 |
| **onToolCallStart/Finish** | ✅ | 记录工具执行 |

### 8.7 错误处理

| 能力 | SDK 支持 | 说明 |
|---|---|---|
| **NoSuchToolError** | ✅ | 工具不存在 |
| **InvalidToolInputError** | ✅ | 工具输入无效 |
| **ToolCallRepairError** | ✅ | 工具调用修复 |
| **experimental_repairToolCall** | ✅ | 自定义修复策略 |
| **API 级重试** | ❌ | 需项目层实现 |

---

## 9. 补齐方案：按 SDK 可行性分类

### 9.1 🟢 可补齐（AI SDK 原生/中间件支持）

#### 9.1.1 多层恢复路径

```typescript
// 利用 prepareStep 实现恢复路径检查
prepareStep: async ({ stepNumber, steps, messages }) => {
  const lastStep = steps[steps.length - 1]
  if (lastStep?.finishReason === 'error' && lastStep.error?.message?.includes('413')) {
    const compacted = await reactiveCompact(messages)
    return { messages: compacted }
  }
  if (tokenBudget.shouldCompact()) {
    const compacted = await sessionCompact(messages)
    return { messages: compacted }
  }
  return {}
}
```

#### 9.1.2 失败触发模型回退

```typescript
// 在 pipeline.ts 的 prepareStep 中增加
prepareStep: async ({ stepNumber, steps }) => {
  const consecutiveErrors = getConsecutiveErrors(steps)
  if (consecutiveErrors >= 2) {
    const fallbackModel = getFallbackModel(sessionState.model)
    if (fallbackModel) {
      sessionState.model = fallbackModel
      return { model: dashscope(fallbackModel) }
    }
  }
  return {}
}
```

#### 9.1.3 权限系统（SDK `needsApproval` 增强）

```typescript
// 利用 SDK 原生 needsApproval
const bash = tool({
  description: '执行 Bash 命令',
  inputSchema: z.object({ command: z.string() }),
  needsApproval: async ({ command }) => isCommandDangerous(command),
  execute: async ({ command }, { abortSignal }) => { /* 执行 */ }
})

// Web 端处理审批：推送到前端 → 用户确认 → tool-approval-response → 重新调用
```

#### 9.1.4 API 自适应重试（LM Middleware）

```typescript
export const retryMiddleware: LanguageModelV3Middleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    const maxRetries = 3
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await doGenerate()
      } catch (error) {
        if (isRateLimitError(error)) await sleep(Math.min(1000 * 2 ** attempt, 10000))
        else if (isAuthError(error)) throw error
        else await sleep(1000 * (attempt + 1))
      }
    }
    throw error
  },
  wrapStream: async ({ doStream }) => { /* 类似实现 */ }
}
```

#### 9.1.5 文件级记忆系统（项目层实现）

```typescript
// 在 prepareStep 中注入记忆
prepareStep: async ({ messages }) => {
  const relevantMemories = await findRelevantMemories(getLastUserMessage(messages), getUserMemoryDir(userId))
  if (relevantMemories.length > 0) {
    const memorySection = buildMemorySection(relevantMemories)
    return { messages: [messages[0], { role: 'system', content: memorySection }, ...messages.slice(1)] }
  }
  return {}
}

// 对话结束后提取记忆
async function extractMemories(messages: ModelMessage[]) {
  const result = await generateText({
    model: dashscope('qwen-plus'),
    system: MEMORY_EXTRACTION_PROMPT,
    messages,
    output: Output.object({ schema: memoryExtractionSchema })
  })
  await writeMemoryFiles(result.output)
}
```

#### 9.1.6 RAG / 语义搜索（SDK 原生 embed + rerank）

```typescript
// RAG Middleware 模式
export const ragMiddleware: LanguageModelV3Middleware = {
  transformParams: async ({ params }) => {
    const lastUserMessage = getLastUserMessageText(params)
    if (!lastUserMessage) return params

    const embedding = await embed({ model: dashscope.embedding('text-embedding-v3'), value: lastUserMessage })
    const sources = await vectorSearch(embedding.embedding, topK: 5)
    const instruction = `请使用以下信息回答问题：\n${sources.map(s => s.content).join('\n\n')}`

    return addToLastUserMessage({ params, text: instruction })
  }
}
```

#### 9.1.7 多提供商支持（SDK 原生 17+ 提供商）

```typescript
const modelRegistry = {
  'qwen-max': dashscope('qwen-max'),
  'claude-sonnet': anthropic('claude-sonnet-4'),
  'gemini-pro': google('gemini-2.5-pro'),
}

prepareStep: async ({ messages }) => {
  const targetModel = sessionState.modelSwapper.checkIntent(messages)
  return { model: modelRegistry[targetModel] }
}
```

#### 9.1.8 结构化输出强制（SDK `Output.object()` + `extractJsonMiddleware`）

```typescript
const result = await generateText({
  model: wrappedModel,
  messages,
  output: Output.object({ schema: z.object({ answer: z.string(), citations: z.array(z.string()) }) })
})
```

#### 9.1.9 QueryEngine 类（项目层封装）

```typescript
class QueryEngine {
  private messages: ModelMessage[] = []
  private agent: ToolLoopAgent
  private fileStateCache = new LRUCache<string, string>()

  constructor(config: QueryEngineConfig) {
    this.agent = new ToolLoopAgent({ model: dashscope(config.model), tools: config.tools, stopWhen: config.stopConditions, prepareStep: config.prepareStep })
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

SDK 无自动截断，可在工具层手动实现：工具 execute 函数中检查输出大小，超过阈值时截断并持久化到临时文件。

#### 9.2.2 工具级 Hooks

SDK 有 `onToolCallStart/Finish`，无 Pre/Post 阻断能力。可在工具 execute 函数前后加 wrapper 实现部分效果。

#### 9.2.3 分层 AbortController

SDK 传递 `abortSignal` 到工具 execute，但无层级结构。可在项目层手动构建树形结构。

#### 9.2.4 依赖注入

SDK 不支持 DI，但可以在项目层通过工厂模式实现类似效果。

---

### 9.3 🔴 无法补齐（受限 Agent 模型能力/SDK 架构）

#### 9.3.1 Prompt 缓存优化（Sticky-on Beta Headers）

**Claude Code**：一旦启用 beta 头，整个会话锁定避免 Prompt 缓存失效。

**无法补齐的原因**：
1. 当前项目使用**通义千问 Agent 模型，不支持 Prompt 缓存**功能
2. SDK 的 Anthropic 提供商支持 `cacheControl`，但无 "sticky" 语义
3. 这是 Claude Code 在 API 调用层的优化，非 SDK 层面设计

**结论**：此功能在当前技术栈下无实现价值，建议放弃。

#### 9.3.2 富工具接口（798 行 Tool.ts 定义）

**无法补齐的原因**：
- SDK 的工具定义只有 `description`, `inputSchema`, `execute`，是纯功能接口
- 渲染元数据、安全分类器等是 Claude Code 自研的 **CLI 特性**
- Web 应用的 UI 渲染由 React 组件控制，不需要同步

**结论**：CLI 特有需求，Web 应用不需要。可通过其他方式（权限系统、UI 组件）实现类似功能。

#### 9.3.3 MCP WebSocket 传输

**无法补齐的原因**：当前 `@ai-sdk/mcp` 不支持 WebSocket。

**结论**：企业场景下 SSE/stdio 已满足需求，非优先级。

#### 9.3.4 VCR 测试基础设施

**无法补齐的原因**：SDK 不内置。

**替代方案**：使用 `nock` 或 `polly.js` 录制 HTTP 请求，DashScope API 是 HTTP 兼容的。

---

## 10. 工作场景驱动的实施优先级

### 10.1 企业私有化部署的核心需求

| 需求 | 优先级 | SDK 实现方式 | 工作量 | 时间线 |
|---|---|---|---|---|
| **文件级记忆系统** | P0 | 项目层 + SDK prepareStep | 2.5 周 | 第 1-3 周 |
| **权限系统** | P0 | SDK `needsApproval` + 规则引擎 | 3 周 | 第 1-3 周 |
| **多层恢复路径** | P0 | SDK `prepareStep` | 1 周 | 第 1-2 周 |
| **API 重试** | P1 | SDK LM Middleware | 1 周 | 第 4-5 周 |
| **失败模型回退** | P1 | SDK `prepareStep` + 异常处理 | 1 周 | 第 4-5 周 |
| **RAG / 知识搜索** | P1 | SDK Middleware + embed | 2 周 | 第 6-7 周 |
| **多提供商支持** | P1 | SDK 原生 | 1 周 | 第 8 周 |
| **结构化输出** | P2 | SDK `Output.object()` | 0.5 周 | 第 9 周 |
| **OTel 集成** | P2 | SDK Telemetry API | 1 周 | 第 10 周 |
| **记忆提取代理** | P2 | SDK side-query | 1 周 | 第 10-11 周 |
| **Session Memory** | P2 | 项目层 + SDK | 1 周 | 第 11 周 |

### 10.2 非必要项（低优先级）

| 项 | 原因 |
|---|---|
| Prompt 缓存优化 | **Agent 模型不支持，无意义** |
| 富工具接口 | CLI 特有，Web 不需要 |
| VCR 测试 | 测试工程问题，有替代方案 |
| MCP WebSocket | 企业场景非必需 |
| 分层 Abort 级联 | 基础 Abort 已满足大部分场景 |
| Langfuse 追踪 | OTel 已覆盖核心需求 |

### 10.3 时间线总览

```
第 1-3 周:   文件记忆核心 + 权限系统 + 多层恢复路径
第 4-5 周:   API 重试 + 失败模型回退
第 6-7 周:   RAG / 知识搜索
第 8 周:     多提供商支持
第 9-10 周:  结构化输出 + OTel + Session Memory + 记忆提取
第 11-12 周: 文件记忆 Phase 2 (SQLite 元数据)
第 13 周+:   按需（向量索引）+ 持续优化
```

**总计**：约 3 个月可补齐所有高价值差距项。

---

## 11. 架构决策建议

### 11.1 关于 ToolLoopAgent

**建议：继续使用 ToolLoopAgent，不要切换到手动循环。**

理由：
1. 当前项目已有流式工具输出和并发执行能力，SDK 的延迟在 Web 场景下感知较弱
2. ToolLoopAgent 提供 `prepareStep`、`stopWhen`、消息历史管理、错误恢复
3. 手动循环需自研流式解析、工具并行、错误恢复
4. AI SDK 迭代速度快，限制可能在未来版本解决

### 11.2 关于中间件策略

**建议：所有增强功能优先使用 LM Middleware 实现。**

理由：
1. 与 SDK 解耦，可独立开发、测试、替换
2. 链式组合（`middleware: [retry, rag, telemetry, guardrails]`）
3. 提供商无关，对所有模型适用
4. 可测试

### 11.3 关于 Prompt 缓存

**建议：放弃此项，专注 Agent 模型不支持的特性。**

当前项目使用通义千问 Agent 模型，不支持 Prompt 缓存。投入开发无回报。

### 11.4 关于记忆系统架构

**建议：文件记忆 + SQLite 元数据 + SDK 中间件注入。**

```
用户消息 → RAG Middleware (可选) → prepareStep (记忆注入) → ToolLoopAgent →
  对话结束 → 记忆提取代理 → 写入文件系统 → 同步 SQLite 元数据
```

- **文件存储**：AI 自主维护，可读写可调试
- **SQLite**：查询加速、使用统计、老化计算
- **Middleware**：RAG 上下文注入（与记忆互补）
- **prepareStep**：对话启动时的记忆召回

### 11.5 一句话总结

AI SDK v6 已覆盖 Claude Code 约 **60%** 的关键设计。记忆系统、权限控制、多提供商、恢复路径、结构化输出等都可通过 SDK 现有能力补齐。受限于 **Agent 模型能力**（无 Prompt 缓存）和 SDK 架构（无流式工具执行、无富工具接口）无法补齐的部分，在 Web 应用场景下影响有限。企业私有化部署应优先聚焦：**文件记忆系统、权限系统、恢复路径** 三项 P0 需求。