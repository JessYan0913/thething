# Token 使用信息展示：问题分析与架构修复方案

> **状态**：⚠️ 本文档已被 [context-usage-redesign.md](./context-usage-redesign.md) 替代实施
>
> 本文档保留为"问题分析与演进历史"。新方案（3 个真相源严格分工 + 4 态显式状态机 + 单一 zod schema）请查阅 [context-usage-redesign.md](./context-usage-redesign.md)。
>
> 本文档 §4 "修复方案" 中的部分方案（`onContextUsage` 回调、ChatPage 字段补全等）已被新方案覆盖或重新设计。**新实施请勿参考本文档 §4**。

## 1. 问题总览

现有 token 统计流程存在两类问题：**数据准确性问题**（展示给用户的数值不一致）和 **架构设计问题**（Core 计算了数据却绕路 DB 让 route 回读）。

---

## 2. 数据准确性问题

### 2.1 `totalTokens` 与 detail bars 不一致

**根因**：`pipeline.ts:207-211` 在后续步骤用 `actualInput + outputReserve` 覆盖了 `totalTokens`，但 `messagesTokens` / `instructionsTokens` / `toolsTokens` 仍然来自 `FullRequestEstimation` 的估算值。两者基于不同数据源（provider 实际计费 vs tokenizer 估算），可能不相等。

**影响**：用户看到 detail 四项之和（消息+指令+工具+输出预留）与底部总计不一致。

**涉及文件**：
- `packages/core/src/modules/agent-control/pipeline.ts` — 第 207-211 行

### 2.2 `_sessionInputTokens` 语义被压缩破坏

`TokenBudgetTracker` 的 `_sessionInputTokens` 有两个用途冲突：
- `accumulate()` 不断累加 provider 返回的真实 `inputTokens`
- `reportCompaction()` 从中减去 `tokensFreed`

结果是：压缩后 `_sessionInputTokens` 既不是累计输入，也不是当前窗口大小。它被用来做两件事：
- `getSummary().usagePercentage` → pipeline 上下文水位提示注入
- `shouldCompact()` → 压缩触发判断

而精确的上下文占用是 `FullRequestEstimation.utilizationPercent`（实际 tokenize 消息）。两者可能显著偏离，尤其是在多次压缩后。

**影响**：水位提示注入可能在不恰当的时机触发，或无法触发。

### 2.3 缓存命中率有一步滞后

`route.ts` 在 `finish-step` 后读 DB 推 `data-context-usage`，但 DB 里的 `contextCachedReadTokens` 和 `contextStepInputTokens` 是 `prepareStep` 开始时从 `accumulate()` 获取的——用的是**上一步**的 provider usage 数据。

**时序**：
```
Step 1 finish → 推 data-context-usage（缓存命中率 = 0，因尚无 accumulate 数据）
Step 2 prepare → accumulate(step1)，写入 DB
Step 2 finish → 读 DB，展示 step1 的缓存命中率（用户以为这是 step2 的）
Step 3 prepare → accumulate(step2)，写入 DB
Step 3 finish → 读 DB，展示 step2 的缓存命中率
```

### 2.4 初始加载丢失 cache/compaction 数据

`ChatPage.tsx` 构造 `contextBudget` 时只映射了 6 个字段，漏掉了：
- `contextCachedReadTokens`
- `contextStepInputTokens`
- `contextLastCompactionFreedTokens`
- `contextCompacted`

**影响**：页面刷新后，在第一次流式 `data-context-usage` 到达之前，缓存命中信息和压缩信息都不显示。如果会话已冷却（无新消息），这些信息永远不出现。

### 2.5 累计会话统计未展示

`TokenBudgetTracker` 维护了 `_sessionInputTokens`、`_sessionOutputTokens`、`_sessionCachedReadTokens` 累计值，但从未发送到前端。用户无法知道"这个会话总共消耗了多少 tokens"。

### 2.6 费用信息完备但未展示

`CostTracker` 完备地跟踪了 `totalCost`、`inputTokens`、`outputTokens`、`cachedReadTokens`，有 `chat_costs` 表持久化，有独立的 `/api/chat/[chatId]/costs` 端点，但前端从未调用或展示。

### 2.7 校准系数收集了但未使用

`TokenBudgetTracker` 的 EMA 校准系数（`calibration`）跟踪实际/估算偏差，精度在 0.5~2.0 之间。但它从未用来调整展示给用户的估算值，也未展示给用户。

---

## 3. 架构设计问题

### 3.1 核心问题：Core 绕路 DB，route 回读

当前数据流：

```
Core (pipeline) 计算完毕
  → updateContextBudget() 写入 DB  ← 不必要的持久化
  → [步骤执行]
  → route 在 finish-step 后读 DB  ← 不必要的回读
  → 推 data-context-usage 到前端
```

Core（`pipeline.ts`）已经完成了所有计算：
- `FullRequestEstimation`（messagesTokens, instructionsTokens, toolsTokens, outputReserve）
- `TokenBudgetTracker` 的 `lastStepInputTokens` / `lastStepCachedReadTokens`
- `compactResult.tokensFreed` / `compactionActive`

但 route 却需要通过 DB 回读这些数据，而不是 Core 直接告诉它。

**问题**：
1. 不必要的 DB 写入 + 读取，增加延迟
2. 时序依赖：`updateContextBudget` 在 `prepareStep` 时写入，`finish-step` 后读取，中间不能有竞态
3. 数据语义在 DB 层丢失：`totalTokens` 在不同步骤代表不同含义（估算值 vs 实际值）

### 3.2 正确架构：Core 主动推送，DB 仅用于持久化

```
Core (pipeline) 计算完毕
  → 回调 onContextUsage() → route 直接入流 → 前端  ← 实时数据流
  → updateContextBudget() 写入 DB                   ← 持久化（仅用于初始加载）
                                                    ↓
                                              ChatPage 初始加载时读 DB
```

两个流各自独立：
- **实时流**：Core 通过 `onContextUsage` 回调直接推给 route，route 入流到前端。零延迟，零绕路。
- **持久化**：`updateContextBudget` 写入 DB 保持不变。`ChatPage.tsx` 初始加载时从 DB 读取，供页面刷新后使用。

---

## 4. 修复方案

### 4.1 架构改造：Core 增加 `onContextUsage` 回调

**`packages/core/src/composition/app/types.ts`** — 增加类型定义：

```typescript
export interface ContextUsageData {
  usagePercentage: number;
  totalTokens: number;
  modelLimit: number;
  messagesTokens?: number;
  instructionsTokens?: number;
  toolsTokens?: number;
  outputReserve?: number;
  cachedReadTokens?: number;
  stepInputTokens?: number;
  cacheHitRatio?: number;
  lastCompactionFreedTokens?: number;
  compactionActive?: boolean;
  sessionInputTokens?: number;
  sessionOutputTokens?: number;
  sessionCachedReadTokens?: number;
}

export interface CreateAgentOptions {
  // ... 现有字段
  /** 每步上下文估算完成后回调，用于实时推送 */
  onContextUsage?: (data: ContextUsageData) => void;
}
```

**`packages/core/src/composition/app/create.ts`** — 透传回调：

```typescript
// 将 options.onContextUsage 传入 pipeline config
const prepareStep = createAgentPipeline<ChatToolsType>({
  ...,
  onContextUsage: options.onContextUsage,
});
```

**`packages/core/src/modules/agent-control/pipeline.ts`** — 在 `prepareStep` 估算完成后调用回调，并修复 `totalTokens` 一致性：

```typescript
// 关键改动：不再用 actualInput + outputReserve 覆盖 totalTokens
// totalTokens 始终 = estimation.totalTokens（与 detail bars 一致）
const actualTotal = estimation.totalTokens;

// 调用回调，实时推送，不绕 DB
config.onContextUsage?.({
  usagePercentage: actualPercent,
  totalTokens: actualTotal,
  modelLimit: config.contextLimit ?? estimation.modelLimit,
  messagesTokens: estimation.messagesTokens,
  instructionsTokens: estimation.instructionsTokens,
  toolsTokens: estimation.toolsTokens,
  outputReserve: estimation.outputReserve,
  // 缓存命中：当前步数据（accumulate 已在上一步执行完毕）
  cachedReadTokens: sessionState.tokenBudget.lastStepCachedReadTokens,
  stepInputTokens: actualInput,
  cacheHitRatio: actualInput > 0
    ? Math.round((sessionState.tokenBudget.lastStepCachedReadTokens / actualInput) * 100)
    : undefined,
  // 压缩信息
  lastCompactionFreedTokens: compactResult.executed ? compactResult.tokensFreed : undefined,
  compactionActive: compactResult.executed,
  // 累计统计
  sessionInputTokens: sessionState.tokenBudget.inputTokens,
  sessionOutputTokens: sessionState.tokenBudget.outputTokens,
  sessionCachedReadTokens: sessionState.tokenBudget.cachedReadTokens,
});

// updateContextBudget 仍然保留（用于 DB 持久化 / 初始加载）
sessionState.updateContextBudget?.({ ... });
```

### 4.2 Route 层：订阅回调，直接入流

**`packages/app/app/api/chat/route.ts`** — 删除 DB 读取逻辑，改用回调：

```typescript
const { agent, sessionState, ... } = await createAgent({
  ...,
  onContextUsage: (data) => {
    controller.enqueue(JSON.stringify({
      type: 'data-context-usage',
      id: `ctx-step-${agentChunkCount}`,
      data,
    }));
  },
});

// 删除 finish-step 后的 DB 读取代码块
// （原第 530-558 行，改为仅保留 todo 推送）
```

### 4.3 初始加载补全

**`packages/app/components/ChatPage.tsx`** — 补传 cache/compaction 字段：

```typescript
const contextBudget = conversation && conversation.contextUsage != null
  ? {
      usagePercentage: conversation.contextUsage,
      totalTokens: conversation.contextTotal ?? 0,
      modelLimit: conversation.contextLimit ?? 0,
      messagesTokens: conversation.contextMessages ?? 0,
      instructionsTokens: conversation.contextInstructions ?? 0,
      toolsTokens: conversation.contextTools ?? 0,
      outputReserve: conversation.contextOutputReserve ?? 0,
      // 新增：
      cachedReadTokens: conversation.contextCachedReadTokens ?? 0,
      cacheHitRatio: conversation.contextStepInputTokens && conversation.contextStepInputTokens > 0
        ? Math.round(((conversation.contextCachedReadTokens ?? 0) / conversation.contextStepInputTokens) * 100)
        : undefined,
      lastCompactionFreedTokens: conversation.contextLastCompactionFreedTokens ?? undefined,
      compactionActive: conversation.contextCompacted ?? undefined,
    }
  : null;
```

### 4.4 前端展示增强

**`packages/app/components/Chat.tsx`**：
- 在弹窗底部增加累计统计行（累计输入/输出/cache tokens）
- 当 `stepInputTokens` 存在时，在 total 行标注"实际输入" vs "估算"的偏差

**`packages/app/components/ConversationSidebar.tsx`**：
- 每条会话旁增加微型 SVG 圆环进度条，颜色规则：
  - >80%：红色
  - >60%：黄色
  - 其他：灰色

### 4.5 不改的

| 模块 | 不改原因 |
|---|---|
| `compact()` / `reportCompaction()` / `shouldCompact()` | 压缩逻辑独立，不受影响 |
| 校准系数展示 | 内部调试指标，展示给用户增加认知负担 |
| 费用展示 | 数据完备但优先级低，可单独做 |

---

## 5. 改动范围总览

| 文件 | 改动类型 | 行数估计 | 影响压缩？ |
|---|---|---|---|
| `core/src/composition/app/types.ts` | 新增 `ContextUsageData` 接口 + `onContextUsage` | +15 | 否 |
| `core/src/composition/app/create.ts` | 透传 `onContextUsage` | +3 | 否 |
| `core/src/modules/agent-control/pipeline.ts` | 调用 `onContextUsage`，修复 `totalTokens` | +20 | 否 |
| `app/api/chat/route.ts` | 订阅回调，删除 DB 读取 | -15 | 否 |
| `app/components/ChatPage.tsx` | 补传 cache/compaction 字段 | +8 | 否 |
| `app/components/Chat.tsx` | 增加累计统计展示 | +30 | 否 |
| `app/components/ConversationSidebar.tsx` | 增加微型水位圆环 | +30 | 否 |

**总计：约 7 个文件，净增约 90 行，无压缩逻辑改动。**

---

## 6. 验证清单

| 验证项 | 预期 |
|---|---|
| detail bars 四项之和 = totalTokens | 始终相等 |
| 缓存命中率显示当前步数据 | 无滞后 |
| 页面刷新后 cache/compaction 信息立即可见 | 无需等待流式推送 |
| 侧边栏每条会话显示水位圆环 | 颜色随使用率变化 |
| 累计统计显示在弹窗底部 | 可查看会话总消耗 |
| 压缩触发不受影响 | 观察 `shouldCompact()` 行为无变化 |
| 旧会话数据兼容 | 空字段 fallback 为 0 / undefined |