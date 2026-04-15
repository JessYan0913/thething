# API 重试 + 上下文溢出恢复 实施计划

> 基于 Claude Code 源码审计、AI SDK v6 类型定义审查、当前项目代码审计的三向验证

## 文档信息

- **创建日期**: 2026-04-15
- **最后更新**: 2026-04-15（SDK 类型审查后重大修订）
- **参考来源**:
  - Claude Code `src/services/api/withRetry.ts` (822 行)
  - Claude Code `src/services/compact/compact.ts` (PTL retry)
  - AI SDK v6.0.158 `index.d.ts` 类型定义（`StepResult`, `PrepareStepFunction`, `PrepareStepResult`, `FinishReason`）
  - 当前项目 `src/lib/` 逐文件审计
- **前置依赖**: 无

---

## ⚠ 审查发现的致命问题（已修正）

> 原版计划有 4 个 BLOCKER 级问题，全部已在本文中修正

| # | 问题 | 原设计 | 审查发现 | 修正 |
|---|---|---|---|---|
| B1 | `StepResult` 没有 `error` 字段 | `lastStep.error` 检测 413 | `StepResult` 类型无 `error` 属性，失败 API 调用不产生 `StepResult` | 改用 route 层 catch |
| B2 | `prepareStep` 在 API 失败后不会被调用 | `prepareStep` 检测错误后恢复 | API 异常直接终止 `doGenerate`/`doStream` 循环，不进入下一步 `prepareStep` | 改用 route 层 retry |
| B3 | 压缩函数类型不匹配 | 使用 `ModelMessage[]` | 实际函数全部使用 `UIMessage[]`，函数名也不对 | 修正类型和函数名 |
| B4 | `PrepareStepResult` 没有 `tools`/`continue` | `{ tools, continue }` 返回 | SDK 类型只有 `model?` `system?` `messages?` `activeTools?` `toolChoice?` | 修正返回类型 |

---

## 目录

- [1. 问题定义](#1-问题定义)
- [2. SDK 约束与设计边界](#2-sdk-约束与设计边界)
- [3. 当前项目差距](#3-当前项目差距)
- [4. Phase 1：API 重试中间件](#4-phase-1api-重试中间件)
- [5. Phase 2：413 上下文溢出恢复](#5-phase-2413-上下文溢出恢复)
- [6. Phase 3：失败触发模型回退](#6-phase-3失败触发模型回退)
- [7. 测试策略](#7-测试策略)
- [8. 风险评估与对策](#8-风险评估与对策)
- [9. 时间线](#9-时间线)

---

## 1. 问题定义

### 1.1 核心场景

| 故障类型 | 触发条件 | 当前处理 | 期望处理 |
|---|---|---|---|
| **临时性错误** | 429 限流、5xx、网络抖动 | 直接报错 | 指数退避重试 |
| **上下文溢出** | 413 / prompt-is-too-long | 无自动恢复 | 压缩后重试 |
| **连续过载** | 连续 overloaded/5xx | 无处理 | 自动降级模型 |

### 1.2 收益评估

DashScope 企业私有化部署场景下：

- **临时性错误**：偶发但存在（网络抖动、5xx），1-2 天可实现，**收益最高**
- **上下文溢出**：极少触发（auto-compact 在到达 413 前就介入），**收益中等**
- **连续过载**：DashScope 企业配额下极低概率，**收益最低**

---

## 2. SDK 约束与设计边界

> 这是原版计划缺失的关键部分。所有设计必须遵守这些约束。

### 2.1 `StepResult` 类型（AI SDK v6.0.158 实际定义）

```typescript
type StepResult<TOOLS extends ToolSet> = {
  readonly stepNumber: number;
  readonly model: { provider: string; modelId: string };
  readonly content: Array<ContentPart<TOOLS>>;
  readonly text: string;
  readonly toolCalls: Array<TypedToolCall<TOOLS>>;
  readonly toolResults: Array<TypedToolResult<TOOLS>>;
  readonly finishReason: FinishReason;  // 'stop'|'length'|'content-filter'|'tool-calls'|'error'|'other'
  readonly usage: LanguageModelUsage;
  readonly request: LanguageModelRequestMetadata;
  readonly response: LanguageModelResponseMetadata & { messages: Array<ResponseMessage> };
  readonly providerMetadata: ProviderMetadata | undefined;
  // ⚠️ 没有 error 字段
  // ⚠️ 没有 statusCode 字段
}
```

**关键约束**：
1. **没有 `error` 字段** — 无法在 `StepResult` 中获取错误详情
2. **失败的 API 调用不产生 `StepResult`** — 当 `doGenerate()`/`doStream()` 抛异常，`generateText` 的 do-while 循环终止，异常传播到外层 catch。没有 `StepResult` 被推入 `steps[]`
3. **`finishReason: 'error'`** 仅在模型正常返回但标注为 error 时出现（如 content-filter），不是 API 异常

### 2.2 `PrepareStepResult` 类型

```typescript
type PrepareStepResult<TOOLS> = {
  model?: LanguageModel;              // ← 支持动态切换模型
  toolChoice?: ToolChoice<TOOLS>;
  activeTools?: Array<keyof TOOLS>;   // ← 替代原计划的 tools
  system?: string | SystemModelMessage | Array<SystemModelMessage>;
  messages?: Array<ModelMessage>;     // ← 支持替换消息
  experimental_context?: unknown;
  providerOptions?: ProviderOptions;
} | undefined;
// ⚠️ 没有 tools 字段
// ⚠️ 没有 continue 字段
```

### 2.3 `LanguageModelV3Middleware` 类型

```typescript
interface LanguageModelV3Middleware {
  specificationVersion: 'v3';
  wrapGenerate?: async ({ doGenerate, doStream, params, model }) => GenerateResult;
  wrapStream?: async ({ doGenerate, doStream, params, model }) => StreamResult;
}
// wrapGenerate 接收 doGenerate 和 doStream 两个函数
// wrapStream 同样接收两个函数
// params 包含完整请求参数
```

### 2.4 设计边界总结

| 机制 | 能做什么 | 不能做什么 |
|---|---|---|
| **retryMiddleware (wrapGenerate)** | 捕获 `doGenerate()` 异常，指数退避重试 | 捕获流式中途错误（stream 已启动后的错误） |
| **retryMiddleware (wrapStream)** | 捕获 `doStream()` 前的异常，重试 | 捕获 stream ReadableStream 中的中途错误 |
| **prepareStep** | 每步前修改 messages/model/system/tools | 检测上一步的 API 异常（因为异常不产生 step） |
| **route 层 catch** | 捕获 `createAgentUIStream` 的顶层异常 | 需要手动重试整个 agent 生成 |

**结论**：413 恢复无法在 `prepareStep` 中实现，必须在 **route 层** 或 **middleware 层** 处理。

---

## 3. 当前项目差距

### 3.1 压缩函数实际签名

| 函数 | 实际签名 | 原计划假设 | 偏差 |
|---|---|---|---|
| `compactViaAPI` | `(messages: UIMessage[], conversationId: string) → Promise<CompactionResult>` | `apiCompactMessages(ModelMessage[])` | 名称不同、类型不同 |
| `trySessionMemoryCompact` | `(messages: UIMessage[], conversationId, config?) → Promise<{messages,executed,tokensFreed}|null>` | `sessionMemoryCompactMessages(ModelMessage[])` | 名称不同、类型不同 |
| `microCompactMessages` | `(messages: UIMessage[], config?) → {messages,executed,tokensFreed}` (同步) | `microCompactMessages(ModelMessage[])` (async) | 类型不同、不应 async |
| `tryPtlDegradation` | `(messages: UIMessage[]) → {messages,executed,tokensFreed}` (同步) | `ptlDegradedMessages(ModelMessage[], conversationId)` (async) | 名称不同、类型不同、不应 async、无 conversationId |

**CompactionResult 类型**：
```typescript
type CompactionResult = {
  messages: UIMessage[];      // ← UIMessage[], 不是 ModelMessage[]
  executed: boolean;
  type: CompactionType | null;
  tokensFreed: number;
  boundaryMessage?: CompactBoundaryMessage;
  summary?: string;
}
```

### 3.2 `ModelMessage` vs `UIMessage`

| 维度 | `ModelMessage` | `UIMessage` |
|---|---|---|
| 来源 | `@ai-sdk/provider-utils` | `ai` 包 |
| 结构 | `{ role, content, providerOptions? }` | `{ id, role, parts, createdAt? }` |
| id 字段 | ❌ 无 | ✅ 有 |
| content | `string | Content[]` | `parts: Part[]` |
| 互相转换 | 需 `as unknown as` 强转 | 同 |

**关键**: 所有压缩函数使用 `UIMessage`。`prepareStep` 的 `messages` 参数是 `ModelMessage[]`。两者不能直接互换——强转虽然运行时可能工作，但丢失 `id` 字段和 `parts` 结构。

---

## 4. Phase 1：API 重试中间件

### 4.1 目标

为所有 LLM API 调用添加指数退避重试，覆盖临时性错误（429/5xx/网络）。

### 4.2 新增文件

**`src/lib/middleware/retry.ts`**

```typescript
import type { LanguageModelV3Middleware } from '@ai-sdk/provider'

const DEFAULT_MAX_RETRIES = 3
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 10_000
const JITTER_FACTOR = 0.25

interface RetryMiddlewareOptions {
  maxRetries?: number
  maxDelayMs?: number
  shouldRetry?: (error: unknown) => boolean
}

function defaultShouldRetry(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  // AI SDK APICallError 有 statusCode 属性
  const status = (error as Record<string, unknown>).statusCode as number | undefined
  const msg = error.message.toLowerCase()

  if (status === 408) return true   // timeout
  if (status === 429) return true   // rate limit
  if (status === 401) return true   // auth (refresh key)
  if (status !== undefined && status >= 500) return true  // server error

  if (msg.includes('fetch failed') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('timeout')) return true
  if (msg.includes('overloaded') || msg.includes('capacity')) return true

  // 不可重试：413（上下文溢出，交由恢复链）、400（输入错误）、403（权限拒绝）
  if (status === 413 || status === 400 || status === 403) return false

  return false
}

function getRetryDelay(attempt: number, maxDelayMs: number): number {
  const base = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), maxDelayMs)
  const jitter = Math.random() * JITTER_FACTOR * base
  return base + jitter
}

export function retryMiddleware(options?: RetryMiddlewareOptions): LanguageModelV3Middleware {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES
  const maxDelayMs = options?.maxDelayMs ?? MAX_DELAY_MS
  const shouldRetry = options?.shouldRetry ?? defaultShouldRetry

  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate }) => {
      let lastError: unknown
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          return await doGenerate()
        } catch (error) {
          lastError = error
          if (attempt > maxRetries || !shouldRetry(error)) throw error
          const delay = getRetryDelay(attempt, maxDelayMs)
          console.log(`[Retry] Generate attempt ${attempt}/${maxRetries} failed, retrying in ${delay.toFixed(0)}ms`)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
      throw lastError
    },

    wrapStream: async ({ doStream }) => {
      // 只能捕获 doStream() 前的异常（连接/认证错误）
      // 流启动后的中途错误无法在此捕获
      let lastError: unknown
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          return await doStream()
        } catch (error) {
          lastError = error
          if (attempt > maxRetries || !shouldRetry(error)) throw error
          const delay = getRetryDelay(attempt, maxDelayMs)
          console.log(`[Retry] Stream attempt ${attempt}/${maxRetries} failed, retrying in ${delay.toFixed(0)}ms`)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
      throw lastError
    },
  }
}
```

### 4.3 接入方式

修改 `src/app/api/chat/route.ts` 中间件链：

```typescript
import { retryMiddleware } from '@/lib/middleware/retry'

const wrappedModel = wrapLanguageModel({
  model: dashscope(sessionState.model),
  middleware: [
    retryMiddleware(),                     // 第一层：捕获可重试错误
    telemetryMiddleware(),                 // 第二层：记录每次调用（含重试）
    costTrackingMiddleware(sessionState.costTracker), // 第三层：最靠近模型
  ],
})
```

**中间件顺序说明**: `wrapLanguageModel` 的 middleware 数组中，第一个 middleware 包裹最外层，最后一个最靠近模型。错误从模型 → costTracking → telemetry → retry 向外传播。retry 捕获后决定是否重试，重试时 telemetry 和 costTracking 会记录每次尝试。

### 4.4 413 在 middleware 层的处理

`retryMiddleware` 的 `defaultShouldRetry` **不重试 413**。413 会直接传播到 route 层的 catch，由 Phase 2 处理。

### 4.5 流式中途错误的局限

**当前无法处理**：`doStream()` 成功返回 `{ stream, ...rest }` 后，stream ReadableStream 中的中途错误（如 DashScope 连接断开）以 stream chunk 形式发出，middleware 无法捕获。这是 AI SDK 的架构限制，不是 bug。

**影响**：DashScope 的流式中途断连极少发生（内网部署），可接受。

---

## 5. Phase 2：413 上下文溢出恢复

### 5.1 设计变更说明

**原设计**：在 `prepareStep` 中检测 `lastStep.error` → 执行恢复 → 返回 `{ messages: compacted }`

**不可实现原因**：
1. `StepResult` 没有 `error` 字段
2. API 抛 413 异常时，`generateText` 循环终止，不产生 `StepResult`
3. `prepareStep` 只在 API 调用前执行，不会在失败后被调用

**新设计**：在 route 层（`src/app/api/chat/route.ts`）catch 413 异常 → 执行压缩降级链 → 重试 `createAgentUIStream`

### 5.2 新增文件

**`src/lib/compaction/recovery.ts`**

```typescript
import type { UIMessage } from 'ai'
import { compactViaAPI } from './api-compact'
import { trySessionMemoryCompact } from './session-memory-compact'
import { microCompactMessages } from './micro-compact'
import { tryPtlDegradation } from './ptl-degradation'
import { estimateMessagesTokens } from './token-counter'

const MAX_RECOVERY_ATTEMPTS = 3

export interface RecoveryResult {
  recovered: boolean
  messages: UIMessage[]
  strategy: RecoveryStrategy
  tokensFreed: number
}

export type RecoveryStrategy =
  | 'api-compact'
  | 'session-memory-compact'
  | 'micro-compact'
  | 'ptl-truncate'
  | 'ptl-degrade'
  | 'none'

export function isContextError(error: unknown): boolean {
  const msg = String(error ?? '').toLowerCase()
  // AI SDK APICallError 可能包含 statusCode
  const status = (error as Record<string, unknown>)?.statusCode as number | undefined
  if (status === 413) return true
  return (
    msg.includes('prompt is too long') ||
    msg.includes('context_length_exceeded') ||
    msg.includes('context window') ||
    msg.includes('token limit') ||
    msg.includes('request too large') ||
    msg.includes('max context')
  )
}

// 策略 1：API Compact（LLM 压缩）
async function tryApiCompact(
  messages: UIMessage[],
  conversationId: string,
): Promise<RecoveryResult | null> {
  try {
    const result = await compactViaAPI(messages, conversationId)
    if (result.executed && result.tokensFreed > 0) {
      return {
        recovered: true,
        messages: result.messages,
        strategy: 'api-compact',
        tokensFreed: result.tokensFreed,
      }
    }
  } catch (err) {
    console.error('[Recovery] API compact failed:', err)
  }
  return null
}

// 策略 2：Session Memory Compact（DB 摘要，无额外 API 调用）
async function trySessionMemoryCompact(
  messages: UIMessage[],
  conversationId: string,
): Promise<RecoveryResult | null> {
  try {
    const result = await trySessionMemoryCompact(messages, conversationId)
    if (result && result.executed && result.tokensFreed > 0) {
      return {
        recovered: true,
        messages: result.messages,
        strategy: 'session-memory-compact',
        tokensFreed: result.tokensFreed,
      }
    }
  } catch (err) {
    console.error('[Recovery] Session memory compact failed:', err)
  }
  return null
}

// 策略 3：Micro Compact（清除旧工具结果，同步）
function tryMicroCompact(
  messages: UIMessage[],
): RecoveryResult | null {
  try {
    const result = microCompactMessages(messages)
    if (result.executed && result.tokensFreed > 5000) {
      return {
        recovered: true,
        messages: result.messages,
        strategy: 'micro-compact',
        tokensFreed: result.tokensFreed,
      }
    }
  } catch (err) {
    console.error('[Recovery] Micro compact failed:', err)
  }
  return null
}

// 策略 4：PTL 截断（丢弃 20% 最旧消息）
function truncateForPTLRetry(messages: UIMessage[]): RecoveryResult | null {
  if (messages.length < 4) return null

  const dropCount = Math.max(2, Math.floor(messages.length * 0.2))
  const remaining = messages.slice(dropCount)

  if (remaining.length === 0) return null

  const beforeTokens = estimateMessagesTokens(messages)
  const afterTokens = estimateMessagesTokens(remaining)

  return {
    recovered: true,
    messages: remaining,
    strategy: 'ptl-truncate',
    tokensFreed: beforeTokens - afterTokens,
  }
}

// 策略 5：PTL Degradation（硬截断兜底，同步）
function fallbackPtlDegradation(messages: UIMessage[]): RecoveryResult {
  const result = tryPtlDegradation(messages)
  if (result.executed) {
    return {
      recovered: true,
      messages: result.messages,
      strategy: 'ptl-degrade',
      tokensFreed: result.tokensFreed,
    }
  }
  // 最终兜底：保留最后 10 条
  const last10 = messages.slice(-10)
  return {
    recovered: true,
    messages: last10,
    strategy: 'ptl-degrade',
    tokensFreed: estimateMessagesTokens(messages) - estimateMessagesTokens(last10),
  }
}

// 统一恢复入口
export async function recoverFromContextError(
  messages: UIMessage[],
  conversationId: string,
): Promise<RecoveryResult> {
  console.log('[Recovery] Starting context overflow recovery')

  const result =
    await tryApiCompact(messages, conversationId) ||
    await trySessionMemoryCompact(messages, conversationId) ||
    tryMicroCompact(messages) ||
    truncateForPTLRetry(messages) ||
    fallbackPtlDegradation(messages)

  console.log(`[Recovery] Strategy: ${result.strategy}, freed ${result.tokensFreed} tokens`)
  return result
}
```

### 5.3 接入方式：route 层 catch + 重试

修改 `src/app/api/chat/route.ts`，在 POST handler 中包裹 `createAgentUIStream` 调用：

```typescript
import { isContextError, recoverFromContextError } from '@/lib/compaction/recovery'

export async function POST(req: Request) {
  try {
    // ... 现有的消息准备、压缩、记忆召回代码 ...

    let currentMessages = compactedMessages
    let recoveryAttempt = 0
    const MAX_RECOVERY_ATTEMPTS = 3

    // 413 恢复重试循环
    for (;;) {
      try {
        // ... 创建 agent、createAgentUIStream 等现有代码 ...
        const { agent, sessionState } = await createChatAgent(
          conversationId, meta, writerRef, currentMessages, { userId, recalledMemoriesContent },
        )

        const stream = createUIMessageStream({
          execute: async ({ writer }) => {
            // ... 现有代码不变 ...
          },
          onError: (err) => String(err),
        })

        return createUIMessageStreamResponse({ stream, headers: { 'X-Conversation-Id': conversationId } })
      } catch (agentError) {
        if (isContextError(agentError) && recoveryAttempt < MAX_RECOVERY_ATTEMPTS) {
          console.log(`[Recovery] 413 detected, attempt ${recoveryAttempt + 1}/${MAX_RECOVERY_ATTEMPTS}`)
          const recovery = await recoverFromContextError(currentMessages, conversationId)
          currentMessages = recovery.messages
          recoveryAttempt++
          continue  // 重试整个 agent 生成
        }
        throw agentError  // 非 413 或超过重试次数，直接抛出
      }
    }
  } catch (error) {
    console.error('[Chat API] POST error:', error)
    return Response.json({ error: 'Failed to process chat request' }, { status: 500 })
  }
}
```

### 5.4 为什么必须在 route 层

```
AI SDK ToolLoopAgent 内部流程：

  prepareStep()  ← 每步前执行，只能修改 messages/model/tools
  ↓
  model.doGenerate() / model.doStream()
  ↓
  如果成功 → StepResult 推入 steps[] → 下一步 prepareStep()
  如果异常 → 整个 generateText 循环终止 → 异常传播到调用者

  413 异常路径：
  retryMiddleware.wrapGenerate → doGenerate() → DashScope 返回 413
  → shouldRetry(413) = false → 413 直接抛出
  → createAgentUIStream 内部 catch
  → 传播到 route.ts 的 POST handler catch
```

`prepareStep` 在整个过程中只在 API 调用**之前**执行。API 失败后没有机会在 `prepareStep` 中恢复。

### 5.5 恢复链流程图

```
DashScope 返回 413
  │
  retryMiddleware: shouldRetry(413) = false → 直接抛出
  │
  route.ts POST catch: isContextError() = true
  │
  ├─ 尝试 1: compactViaAPI (LLM 压缩) → 成功 → 重试 createAgentUIStream
  │                                    → 失败 ↓
  ├─ 尝试 2: trySessionMemoryCompact (DB 摘要) → 成功 → 重试
  │                                          → 失败 ↓
  ├─ 尝试 3: microCompactMessages (清除旧工具结果) → 省出 >5K → 重试
  │                                                → 不够 ↓
  ├─ 尝试 4: truncateForPTLRetry (丢弃 20% 最旧) → 成功 → 重试
  │                                              → 失败 ↓
  └─ 尝试 5: tryPtlDegradation (硬截断兜底) → 一定成功 → 重试

  重试仍 413? → recoveryAttempt++ → 最多 3 次 → 最终报错
```

---

## 6. Phase 3：失败触发模型回退

### 6.1 设计变更说明

**原设计**：在 `prepareStep` 中通过 `steps[].finishReason === 'error'` 检测连续失败

**不可实现原因**：`StepResult` 无 `error` 字段，且 API 异常不产生 `StepResult`

**新设计**：在 `retryMiddleware` 中追踪连续失败次数，当达到阈值时设置 `sessionState` 的回退标记，`prepareStep` 读取标记后返回 `{ model: wrappedFallbackModel }`

### 6.2 重试中间件增加回退追踪

修改 `src/lib/middleware/retry.ts`，增加连续失败追踪回调：

```typescript
interface RetryMiddlewareOptions {
  maxRetries?: number
  maxDelayMs?: number
  shouldRetry?: (error: unknown) => boolean
  onConsecutiveFailures?: (count: number, lastError: unknown) => void  // ← 新增
}

// wrapGenerate 中增加：
let consecutiveFailures = 0
for (let attempt = 1; ...; attempt++) {
  try {
    const result = await doGenerate()
    consecutiveFailures = 0  // 成功时重置
    return result
  } catch (error) {
    consecutiveFailures++
    if (options.onConsecutiveFailures && consecutiveFailures >= 3) {
      options.onConsecutiveFailures(consecutiveFailures, error)
    }
    // ... 现有重试逻辑 ...
  }
}
```

### 6.3 pipeline.ts 中读取回退标记

```typescript
const prepareStep: PrepareStepFunction<TOOLS> = async ({ stepNumber, messages }) => {
  // 检查是否需要模型回退（由 retryMiddleware 的 onConsecutiveFailures 设置）
  if (sessionState.needsModelFallback) {
    const fallbackModel = sessionState.modelSwapper.getFallbackModel()
    if (fallbackModel) {
      sessionState.needsModelFallback = false
      sessionState.model = fallbackModel.id
      return {
        model: wrapLanguageModel({
          model: dashscope(fallbackModel.id),
          middleware: [retryMiddleware(), telemetryMiddleware(), costTrackingMiddleware(sessionState.costTracker)],
        }),
      }
    }
  }

  // ... 现有逻辑 ...
}
```

### 6.4 ModelSwapper 新增方法

```typescript
// model-switching.ts 中新增
getFallbackModel(): ModelProvider | null {
  const current = this._config.availableModels.find(m => m.id === this._currentModel)
  if (!current) return null
  const cheaper = this._config.availableModels
    .filter(m => m.costMultiplier < current.costMultiplier)
    .sort((a, b) => a.costMultiplier - b.costMultiplier)
  return cheaper[0] ?? null
}
```

### 6.5 SessionState 新增字段

```typescript
interface SessionState {
  // ... 现有字段 ...
  needsModelFallback: boolean  // ← 新增
}
```

在 route.ts 中连接回调：

```typescript
const sessionState = createSessionState(conversationId, { ... })

retryMiddleware({
  onConsecutiveFailures: (count, error) => {
    console.log(`[Retry] ${count} consecutive failures, triggering model fallback`)
    sessionState.needsModelFallback = true
  },
})
```

---

## 7. 测试策略

### 7.1 单元测试

| 测试目标 | 测试场景 |
|---|---|
| `retryMiddleware` | 429 → 重试成功；5xx → 重试成功；413 → 不重试直接抛出；400 → 不重试 |
| `isContextError` | 各种 413/PTL 错误消息模式识别；statusCode=413 检测 |
| `recoverFromContextError` | 降级链顺序；各策略成功/失败路径；最终兜底 |
| `truncateForPTLRetry` | 丢弃 20% 最旧消息；消息数 < 4 返回 null |
| `getFallbackModel` | 有更便宜模型时返回；无更便宜模型时返回 null |

### 7.2 集成测试

| 场景 | 方法 |
|---|---|
| 429 → 重试 → 成功 | mock DashScope 返回 429 → 第二次成功 |
| 413 → API Compact → 重试成功 | mock 413 → 验证 compactViaAPI 被调用 → 第二次成功 |
| 413 → 所有策略失败 → PTL Degradation | mock 压缩全失败 → 验证硬截断兜底 |
| 连续 3 次 5xx → 模型回退 | mock 3 次 500 → 验证 qwen-max → qwen-plus 切换 |

---

## 8. 风险评估与对策

| 风险 | 严重性 | 概率 | 对策 |
|---|---|---|---|
| **route 层重试增加延迟** | 中 | 高 | 压缩本身 1-3 秒，加上重试 413 最多增加 10 秒 |
| **压缩函数类型都是 UIMessage** | 低 | 确定 | `recovery.ts` 全部使用 `UIMessage[]`，route 层天然使用 `UIMessage` |
| **流式中途错误无法恢复** | 中 | 低（内网） | 接受风险，未来可考虑 stream wrapper |
| **telemetry 记录每次重试尝试** | 低 | 确定 | 可在 costTracking 中标注 `isRetry: true` 区分 |
| **413 恢复后仍 413（无限循环）** | 高 | 低 | `MAX_RECOVERY_ATTEMPTS = 3` 硬限制 |
| **PTL 截断破坏 tool_call/tool 配对** | 中 | 中 | 截断后 UIMessage 的 parts 结构自动保持配对 |

---

## 9. 时间线

```
第 1 天:    Phase 1 — retryMiddleware 编写 + 接入 route.ts
第 2 天:    Phase 1 — 测试验证（mock 429/5xx 场景）
第 3-4 天:  Phase 2 — recovery.ts 编写（使用 UIMessage[]，正确函数名）
第 5 天:    Phase 2 — route.ts 接入（catch + 重试循环）
第 6 天:    Phase 2 — 测试验证
第 7 天:    Phase 3 — ModelSwapper.getFallbackModel + retryMiddleware 回调追踪
```

**总计**：7 天完成全部 3 个 Phase。

---

## 附录 A：AI SDK v6 类型约束速查

| 类型 | 关键字段 | 关键缺失 |
|---|---|---|
| `StepResult` | stepNumber, content, text, toolCalls, toolResults, finishReason, usage | ❌ error, statusCode |
| `PrepareStepResult` | model?, system?, messages?, activeTools?, toolChoice? | ❌ tools, continue |
| `FinishReason` | 'stop'|'length'|'content-filter'|'tool-calls'|'error'|'other' | — |
| `LanguageModelV3Middleware` | specificationVersion:'v3', wrapGenerate?, wrapStream? | — |

## 附录 B：项目压缩函数实际签名速查

| 函数 | 文件 | 签名 |
|---|---|---|
| `compactViaAPI` | `api-compact.ts` | `(UIMessage[], string) → Promise<CompactionResult>` |
| `trySessionMemoryCompact` | `session-memory-compact.ts` | `(UIMessage[], string, config?) → Promise<{messages,executed,tokensFreed}|null>` |
| `microCompactMessages` | `micro-compact.ts` | `(UIMessage[], config?) → {messages,executed,tokensFreed}` (同步) |
| `tryPtlDegradation` | `ptl-degradation.ts` | `(UIMessage[]) → {messages,executed,tokensFreed}` (同步) |
| `compactMessagesIfNeeded` | `index.ts` | `(UIMessage[], string) → Promise<CompactionResult>` |