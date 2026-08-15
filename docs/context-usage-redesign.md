# 上下文工程与用量展示重构方案

> **状态**：实施指南 + 下一阶段设计（§2.4 / §14）。`state-tracker.ts` 与 `budget-schema.ts` 已落地（§3/§5），UI 端消费（SSE 全快照 / 四态机）未完成，见 §2.4 A3。
> **前置文档**：[token-usage-architecture.md](./token-usage-architecture.md)（问题分析 + 历次修复演进）
> **配套架构**：[compaction-redesign.md](./compaction-redesign.md)（上下文压缩唯一权威文档，含输出侧 §10 设计；本档 §14 为其 P0 实施计划）
> **目标**：3 个真相源严格分工、4 态显式状态机、单一 zod schema、可发布可回滚 + 显示与引擎同源（§2.4）+ 输出侧 / 外部化 / 模型主动 / 精益化（§14）

---

## 1. 背景与目标

### 1.1 当前问题（一句话版）
12 字段 × 平均 6 处独立定义 ≈ 80 故障点；3 套真相源（estimation / tracker / DB）通过静默 fallback 互替；状态由字段推导而非显式枚举；UI 散落 4 处 clamp；文档与实现已漂移（侧边栏水位圆环在规划文档中存在但实现里没有）。详见审计章节 [token-usage-architecture.md §2-3](./token-usage-architecture.md)。

### 1.2 重构目标
1. **真相对齐**：utilizationPercent 唯一来自 estimation，compactionsCount 唯一来自 CompactionStateTracker，sessionCost 唯一来自 CostTracker——三方严格不混用
2. **状态显式**：4 态枚举 `{ idle, compacting, justCompacted, overBudget }`，UI 只读 state
3. **类型即文档**：单一 zod schema 跨 core/app 共享，所有边界 `.parse()` 验证
4. **写少推少**：DB 写由"每步"改为"质变 + 节流"；SSE 推由"每步"改为"变化 ≥ 5% 或状态变化"

### 1.3 不在范围（v1 不做）
- 详情条 4 段（messages/instructions/tools/outputReserve）——等 3 个最小点稳定后做
- `ConversationSidebar` 水位圆环——非紧急
- 费用展示（`/api/chat/[chatId]/costs` 端点已有，前端未消费）——单独工单
- 真实 tokenizer 替换 char-estimation——性能验证后再议
- i18n / a11y——本工单不涉及

---

## 2. 三方真相源（核心架构）

### 2.1 分工

| 真相源 | 算的什么 | 谁维护 | 谁消费 | 数据流 |
|---|---|---|---|---|
| `FullRequestEstimation` | 当前 messages 的精确 tokenize | `pipeline.ts` 每步 `prepareStep` | UI 圆环、压缩触发判定 | 内存 → SSE → UI |
| `CompactionStateTracker` | 压缩事件累计（次数 + 总释放量 + 状态） | `pipeline.ts` 压缩前后调用 | UI 压缩徽章、DB 持久化 | 内存 → SSE → UI / DB |
| `CostTracker` | 计费累计（input/output/cache/费用） | `route.ts` `onStepEnd` 累加 | UI 会话消耗统计、DB 持久化 | 内存 → SSE → UI / DB |

### 2.2 严格不混用的边界

**禁止**：
- ❌ 用 `_sessionInputTokens + _sessionOutputTokens` / `maxContextTokens` 算 utilizationPercent
- ❌ 用 `lastCompactionTokens > 0` 推导 compactionActive
- ❌ 用 `lastStepCachedReadTokens / lastStepInputTokens` 当 cacheHitRatio（分子分母量纲不同）
- ❌ 用 `summary.usagePercentage` 兜底 `estimation.utilizationPercent`（静默 fallback → 反馈循环）

**为什么必须严格**：
- estimation 算的是"**如果现在发请求会用多少**"——窗口视角
- tracker 累加的是"**已花多少计费**"——成本视角
- 两者正交，把它们当一个东西 = bug 源（参见 [token-usage-architecture.md §2.2](./token-usage-architecture.md)）

### 2.3 三个最小数据点

| 字段 | 类型 | 范围 | 含义 |
|---|---|---|---|
| `utilizationPercent` | `number` | 0-100 | 当前窗口使用率，**用户决策主指标** |
| `compaction.state` | `'idle' \| 'compacting' \| 'justCompacted'` | 枚举 | 压缩状态机当前态 |
| `compaction.compactionsCount` | `number` | ≥ 0 单调非递减 | 累计压缩次数 |
| `compaction.totalFreed` | `number` | ≥ 0 单调非递减 | 累计释放 tokens |
| `sessionCost.inputTokens` | `number` | ≥ 0 | 累计计费 input |
| `sessionCost.outputTokens` | `number` | ≥ 0 | 累计计费 output |
| `sessionCost.totalCostUsd` | `number` | ≥ 0 | 累计费用 |

**砍掉的字段**（v1 不做）：
- `cacheHitRatio`：分子 session 累计、分母 last-step，量纲错
- `messagesTokens` / `instructionsTokens` / `toolsTokens` 详情条
- `compactionTriggerWatermark` 作为展示字段（与 `triggerPercent` 重复）
- `lastCompactionFreedTokens` 单步值（用 `totalFreed` 累计代替）

### 2.4 显示准确性补强（引擎-显示同源，四项）

> 状态：**A1/A2 已实施（2026-08-15）**；A3/A4 未做。A1/A2 把 `utilizationPercent` 从"估算值"推向"引擎权威口径"，让圆环和压缩引擎看到同一个数。

**现状数据流（已核实）**：`pipeline.ts` 每步 `estimateFullRequest` → `utilizationPercent = (messages+instructions+tools+outputReserve) / modelLimit × 100`（`token-counter.ts:364`）→ SSE 推 `usagePercentage`（`route.ts:516`）+ DB 写 `context_usage` → `Chat.tsx:1146` 圆环。

**A1. 显示吃引擎权威口径（`totalTokensWithBuffer`），与触发/闸门同源**
- 问题：压缩引擎决策用 `request-budget.ts` 的 `totalTokensWithBuffer`（含 usage 真值 EMA 校准的 tokenizerBuffer）；UI 圆环用未校准的 `utilizationPercent`。窗口越紧、估算偏差越大，UI 比引擎"看到的"偏低——用户看到的和系统实际判定不同源。
- 改法：`estimation` 已暴露 `totalTokensWithBuffer`（`request-budget.ts:30`），圆环利用率改用 `totalTokensWithBuffer / modelLimit × 100`。对应 compaction-redesign §4.8"UI 水位从 policy 读"。

**A2. 刻度与引擎行为对齐（画 trigger/hardLimit 标记）**
- 问题：圆环分母是 `modelLimit`，100% ≠ 压缩触发点。引擎在 `triggerTokens = effectiveBudget − buffer`（128k 窗口约 80% 出头）就主动压缩，用户看到圆环还很空，实际已压缩——"危险区"与行为脱节。
- 改法：`estimation` 已暴露 `triggerTokens / hardLimitTokens`（`request-budget.ts:34-36`）；圆环在 policy 刻度上画 trigger/hardLimit 标记（触发点、强制点），`triggerPercent` 已在 `CompactionSnapshotSchema`（§3.2）中，不新增展示字段。

**A3. 四态机送到 UI（SSE 推全快照，不重建自旧字段）**
- 问题：`state-tracker.ts`（idle/compacting/justCompacted）+ `budget-schema.ts`（含 `source: live|db-loaded`）已建，但 SSE 只推 `usagePercentage`，`ChatPage.tsx:13` 仍从旧 `context_usage` 字段重建快照——压缩中显示旧值、压缩后骤降无解释、历史载入分不清 live/过期。
- 改法：SSE 推完整 `ContextBudgetSnapshot`（§6 已设计单一构造点）；圆环三态表达（compacting 显示"压缩中"、justCompacted 显示"已释放 X tokens"、overBudget 标红）；`source` 区分实时/历史，陈旧值不冒充当前值。

**A4. provider 真值闭环到显示**
- 问题：provider 每步返回 `usage.inputTokens` 是免费真值，当前只喂压缩决策的校准器（`usage-calibrator`），没喂显示。
- 改法：有真值时显示真值占比（上一步真实 input 的窗口占比），请求之间无真值时显示校准估算——显示不依赖估算精度的运气。配套：分母 `modelLimit` 优先用 provider/ModelSpec 显式能力，避免 fallback 默认 128k（`capabilities.ts`；与 §13"多模型 contextLimit 切换"联动）。

---

## 3. CompactionStateTracker（新增模块）

### 3.1 文件位置
`packages/core/src/modules/compaction/state-tracker.ts`

### 3.2 类骨架

```ts
import { z } from 'zod';

export const CompactionState = z.enum(['idle', 'compacting', 'justCompacted']);
export type CompactionState = z.infer<typeof CompactionState>;

export const CompactionSnapshotSchema = z.object({
  state: CompactionState,
  compactionsCount: z.number().int().nonnegative(),
  totalFreed: z.number().int().nonnegative(),
  triggerPercent: z.number().min(0).max(1),  // 0-1
});
export type CompactionSnapshot = z.infer<typeof CompactionSnapshotSchema>;

export class CompactionStateTracker {
  private _state: CompactionState = 'idle';
  private _compactionsCount = 0;
  private _totalFreed = 0;
  private _justCompactedStep = -1;
  private readonly _triggerPercent: number;

  constructor(opts: { triggerPercent: number }) {
    if (opts.triggerPercent < 0 || opts.triggerPercent > 1) {
      throw new Error(`triggerPercent must be 0-1, got ${opts.triggerPercent}`);
    }
    this._triggerPercent = opts.triggerPercent;
  }

  /** 准备执行压缩前调用 */
  recordAttempt(stepNumber: number): void {
    this._state = 'compacting';
  }

  /** 压缩执行后调用；freed 来自 estimateMessagesDiff（真值） */
  recordResult(freed: number, stepNumber: number): void {
    if (freed > 0) {
      this._compactionsCount++;       // 不变式：单调非递减
      this._totalFreed += freed;      // 不变式：单调非递减
      this._state = 'justCompacted';
      this._justCompactedStep = stepNumber;
    } else {
      this._state = 'idle';
    }
  }

  /** prepareStep 开头调用：N 步后从 justCompacted 自动回 idle */
  tickStep(stepNumber: number, justCompactedDurationSteps = 1): void {
    if (this._state === 'justCompacted' && stepNumber > this._justCompactedStep + justCompactedDurationSteps) {
      this._state = 'idle';
    }
  }

  getSnapshot(): CompactionSnapshot {
    return {
      state: this._state,
      compactionsCount: this._compactionsCount,
      totalFreed: this._totalFreed,
      triggerPercent: this._triggerPercent,
    };
  }
}
```

### 3.3 不变式（CI 必测）

| ID | 不变式 | 验证 |
|---|---|---|
| INV-1 | `compactionsCount` 单调非递减 | 任意连续两步快照，`prev.compactionsCount <= next.compactionsCount` |
| INV-2 | `totalFreed` 单调非递减 | 同上 |
| INV-3 | `totalFreed === sum of per-step freed` | 测试中 mock recordResult 调用序列 |
| INV-4 | `state` 只在 4 个值之间 | 类型系统强制 |
| INV-5 | `state === 'compacting'` → 下一步必为 `'justCompacted' \| 'idle'` | 测试 |

---

## 4. 与压缩系统的对接（pipeline.ts 改动）

### 4.1 改动点：`packages/core/src/modules/agent-control/pipeline.ts`

**当前**（[pipeline.ts:160-170](packages/core/src/modules/agent-control/pipeline.ts#L160-L170)）：
```ts
const compactResult = await sessionState.compact(messages);
if (compactResult.executed) {
  const triggerWatermark = ...;
  config.compactionCallbackRef?.current?.({ status: 'start', triggerWatermark });
  messages = compactResult.messages;
  sessionState.tokenBudget.reportCompaction(compactResult, triggerWatermark);  // ← 删
  config.compactionCallbackRef?.current?.({ status: 'end', triggerWatermark, tokensFreed: ... });
}
```

**重构后**：
```ts
// 阶段 0：并行运行，保留旧 reportCompaction，验证新 tracker 行为一致后再删

// 在 prepareStep 入口：
sessionState.compactionTracker.tickStep(stepNumber);

// 压缩执行
sessionState.compactionTracker.recordAttempt(stepNumber);
const compactResult = await sessionState.compact(messages);
sessionState.compactionTracker.recordResult(compactResult.tokensFreed ?? 0, stepNumber);

if (compactResult.executed) {
  messages = compactResult.messages;
  // 触发 SSE start/end（保留旧 callback 机制，但 freed 来自 tracker）
  const snapshot = sessionState.compactionTracker.getSnapshot();
  config.compactionCallbackRef?.current?.({
    status: 'start',
    triggerPercent: snapshot.triggerPercent,
  });
  config.compactionCallbackRef?.current?.({
    status: 'end',
    triggerPercent: snapshot.triggerPercent,
    tokensFreed: compactResult.tokensFreed ?? 0,
  });
}
```

### 4.2 改动点：`packages/core/src/composition/app/create.ts`

**当前**（[create.ts:414-424](packages/core/src/composition/app/create.ts#L414-L424)）：
```ts
const prepareStep = createAgentPipeline({
  ...
  triggerPercent: compactionCfg.contextWindow.triggerPercent,
});
```

**重构后**：在 create.ts 实例化时构造 tracker：
```ts
const compactionTracker = new CompactionStateTracker({
  triggerPercent: compactionCfg.contextWindow.triggerPercent,
});

const sessionState = createSessionState(conversationId, {
  ...sessionOptions,
  compactionTracker,  // 注入到 sessionState
  ...
});
```

并在 `PipelineContext` 接口（[interfaces.ts:122-148](packages/core/src/modules/session/interfaces.ts#L122-L148)）新增：
```ts
compactionTracker: CompactionStateTracker;
```

### 4.3 删除 `tokenBudget.reportCompaction` 的理由

参考 [token-usage-architecture.md §2.2](./token-usage-architecture.md) 的"语义错位"分析：
- `tokensFreed` = `estimateMessagesDiff(before, after)`（messages 真实差）
- `_sessionInputTokens` 累加的是 provider 计费 input（含 cache_read）
- **两者语义不对应**——即使减也减错

**重构后**：
- 压缩释放量由 `compactionTracker.totalFreed` 维护（**单调累加，无歧义**）
- `TokenBudgetTracker` 不再减 input
- `utilizationPercent` 由 estimation 反映（压缩后 messages 减少，estimation 自动下降）

### 4.4 `shouldCompact` 改读 estimation

**当前**（[token-budget.ts:99-101](packages/core/src/modules/session/token-budget.ts#L99-L101)）：
```ts
shouldCompact(): boolean {
  return this.totalTokens > this.maxContextTokens - this.compactThreshold;
}
```

**重构后**（移到 pipeline.ts）：
```ts
// pipeline.ts prepareStep 末尾
const shouldCompact = estimation.utilizationPercent >= compactionTracker.triggerPercent * 100;
if (shouldCompact) {
  // 下一步会自动触发
}
```

---

## 5. ContextBudgetSnapshot zod schema（新增模块）

### 5.1 文件位置
`packages/core/src/services/context/budget-schema.ts`

### 5.2 Schema 定义

```ts
import { z } from 'zod';
import { CompactionSnapshotSchema } from '../../modules/compaction/state-tracker';

export const SessionCostSnapshotSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedReadTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
});
export type SessionCostSnapshot = z.infer<typeof SessionCostSnapshotSchema>;

export const ContextBudgetSnapshotSchema = z.object({
  // === estimation 维度（窗口使用率） ===
  utilizationPercent: z.number().min(0).max(100),
  totalTokens: z.number().int().nonnegative(),
  modelLimit: z.number().int().positive(),

  // === compaction 维度（事件累计） ===
  compaction: CompactionSnapshotSchema,

  // === cost 维度（计费累计） ===
  sessionCost: SessionCostSnapshotSchema,

  // === 元数据 ===
  capturedAt: z.string().datetime(),
  source: z.enum(['live', 'db-loaded']),
});
export type ContextBudgetSnapshot = z.infer<typeof ContextBudgetSnapshotSchema>;
```

### 5.3 边界验证规则

| 边界 | 入口 | 出口 | 验证 |
|---|---|---|---|
| Core 推 SSE 前 | `buildContextBudgetPayload()` | `controller.enqueue` | `ContextBudgetSnapshotSchema.parse(payload)` |
| Core 写 DB 前 | `buildContextBudgetPayload()` | `conversationStore.updateContextBudget` | 同上 |
| DB 读出转 prop | `GET /api/conversations` | `ChatPage` 接收 | `ContextBudgetSnapshotSchema.parse(row)` |
| SSE 推前端 | `data-context-usage` | `Chat` `useEffect` | 前端用同一 schema `.parse()`（共享包路径） |

**任何字段不匹配都 throw**——不留静默 `undefined` 的口子。

### 5.4 跨包共享

`packages/core/src/index.ts` export `ContextBudgetSnapshotSchema` 与 `ContextBudgetSnapshot` 类型。`packages/app` 通过 `@/core` 路径 import（视实际 monorepo 配置）。

---

## 6. 数据推送（route.ts 改动）

### 6.1 单一构造点

**新增** `packages/app/app/api/chat/context-payload.ts`：
```ts
import { ContextBudgetSnapshotSchema, type ContextBudgetSnapshot } from '@/core/services/context/budget-schema';
import { logger } from '@/core/primitives/logger';

export function buildContextBudgetPayload(sessionState: SessionState): ContextBudgetSnapshot | null {
  const est = sessionState.lastEstimation;
  if (!est) {
    // INVARIANT: SDK 顺序保证 prepareStep 在 onStepEnd 之前。
    // 走到这里说明 abort/retry 路径未清理；宁可漏推，不发脏数据。
    logger.error('BUG', 'onStepEnd fired before prepareStep; skipping context payload');
    return null;
  }

  return {
    utilizationPercent: est.utilizationPercent,
    totalTokens: est.totalTokens,
    modelLimit: est.modelLimit,
    compaction: sessionState.compactionTracker.getSnapshot(),
    sessionCost: sessionState.costTracker.getSessionCostSnapshot(),
    capturedAt: new Date().toISOString(),
    source: 'live',
  };
}

export function safeParseContextBudget(data: unknown): ContextBudgetSnapshot | null {
  const result = ContextBudgetSnapshotSchema.safeParse(data);
  if (!result.success) {
    logger.error('BUG', `ContextBudgetSnapshot parse failed: ${result.error.message}`);
    return null;
  }
  return result.data;
}
```

### 6.2 替换 `route.ts` 的 4 处 inline 构造

当前 [route.ts:480-525](packages/app/app/api/chat/route.ts#L480-L525) 和 [route.ts:553-595](packages/app/app/api/chat/route.ts#L553-L595) 共 4 处 inline 构造 `data-context-usage` 事件。

**重构后**：
```ts
// 替换 route.ts:483-501
const payload = buildContextBudgetPayload(sessionState);
if (payload) {
  const validated = ContextBudgetSnapshotSchema.parse(payload);
  controller.enqueue(JSON.stringify({
    type: 'data-context-usage',
    id: 'ctx-on-step-end',
    data: validated,
  }));

  // 写 DB（同样用 validated）
  sessionState.updateContextBudget?.(validated);
}
```

### 6.3 何时推 SSE

| 触发 | 原因 |
|---|---|
| `compaction.state` 变化 | UI 必须立刻反应 |
| `utilizationPercent` 变化 ≥ 5% | 减少高频推送 |
| `data-compaction-status` 事件 | start/end 信号 |

**实现**：`route.ts` 在 onStepEnd 内**不直接推**，而是通过 diff 判定：
```ts
const prev = sessionState.lastPushedSnapshot;
const next = buildContextBudgetPayload(sessionState);
if (next && shouldPush(prev, next)) {
  controller.enqueue(...);
  sessionState.lastPushedSnapshot = next;
}

function shouldPush(prev: ContextBudgetSnapshot | null, next: ContextBudgetSnapshot): boolean {
  if (!prev) return true;
  if (prev.compaction.state !== next.compaction.state) return true;
  if (Math.abs(prev.utilizationPercent - next.utilizationPercent) >= 5) return true;
  return false;
}
```

---

## 7. 持久化策略

### 7.1 何时写 DB

| 触发 | 原因 |
|---|---|
| `compaction.state` 转换（`idle ↔ compacting ↔ justCompacted`） | 状态机质变 |
| `utilizationPercent` 跨 80% 阈值 | 侧边栏需知"快满了" |
| `agent.dispose()` | 兜底 |
| 每 10 步一次（节流） | 防止长 session 完全不写 |

**每步不写**。

### 7.2 防止反馈循环（关键）

**问题**：当前 [route.ts:488, 510](packages/app/app/api/chat/route.ts#L488) 写 DB 时也有 `?? summary.usagePercentage` fallback，导致 SSE 写脏数据到 DB，下次刷新通过 `contextBudget` prop 复活脏数据。

**修复**：
1. `buildContextBudgetPayload` 永远不返回脏数据（`if (!est) return null`）
2. 写 DB 永远用 `validated`（已 parse），不用 fallback
3. 迁移期旧 DB 脏数据：通过 `safeParseContextBudget` 校验失败则置 null（前端显示"--"而不是 251%）

### 7.3 DB Schema 演进（v18）

**新增列**（用 SQLite ALTER TABLE 兼容）：
```sql
-- v17 → v18 migration
ALTER TABLE conversations ADD COLUMN context_compaction_state TEXT;
ALTER TABLE conversations ADD COLUMN context_compactions_count INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN context_total_freed INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN context_session_input INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN context_session_output INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN context_session_cost REAL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN context_captured_at TEXT;
```

**保留旧列**（兼容）：
- `context_usage`, `context_total`, `context_limit`, `context_messages`, `context_instructions`, `context_tools`, `context_output_reserve`, `context_cached_read_tokens`, `context_step_input_tokens`, `context_last_compaction_freed_tokens`, `context_compacted`

**逐步迁移**：v18 写新列 + 旧列；v19 删旧列（待 v18 稳定后单独 PR）。

---

## 8. UI 改动

### 8.1 文件
- 新增：`packages/app/components/context/ContextRing.tsx`
- 新增：`packages/app/components/context/ContextDetail.tsx`
- 新增：`packages/app/components/context/format.ts`（纯函数，唯一允许 `Math.min` 的位置）
- 改：`packages/app/components/Chat.tsx`（替换 prop/state 类型，删除散落 clamp）
- 改：`packages/app/components/ChatPage.tsx`（用新 schema 映射）
- 改：`packages/app/app/api/chat/route.ts`（4 处 inline 构造替换）

### 8.2 圆环（最小可用）

```tsx
// packages/app/components/context/ContextRing.tsx
import { cn } from '@/lib/utils';
import type { ContextBudgetSnapshot } from '@/core/services/context/budget-schema';

export function ContextRing({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  // schema 保证 utilizationPercent ∈ [0, 100]，无需 Math.min
  const pct = snapshot.utilizationPercent;
  const color = pct > 80 ? 'text-destructive' :
                pct > 60 ? 'text-yellow-500' :
                'text-primary/60';

  return (
    <div className="flex items-center gap-1">
      <svg width="18" height="18" viewBox="0 0 20 20" className="-rotate-90 shrink-0">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5"
                className="text-muted-foreground/30" />
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 50.27} 50.27`}
                className={cn('transition-all duration-700', color)} />
      </svg>
      <span className={cn('text-xs tabular-nums', color)}>
        {pct.toFixed(0)}%
      </span>
      {snapshot.compaction.state === 'compacting' && (
        <span className="inline-flex items-center gap-1 text-xs text-orange-500 ml-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
          压缩中
        </span>
      )}
      {snapshot.compaction.state === 'justCompacted' && (
        <span className="text-xs text-orange-500 ml-1">已压缩</span>
      )}
    </div>
  );
}
```

### 8.3 详情面板（仅 3 段）

```tsx
// packages/app/components/context/ContextDetail.tsx
import type { ContextBudgetSnapshot } from '@/core/services/context/budget-schema';
import { formatK } from './format';

export function ContextDetail({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  return (
    <div className="space-y-2 text-xs">
      <Row label="当前使用" value={`${snapshot.utilizationPercent.toFixed(0)}%`} />
      <Row label="窗口" value={`${formatK(snapshot.totalTokens)} / ${formatK(snapshot.modelLimit)}`} />
      <Row label="压缩阈值" value={`${(snapshot.compaction.triggerPercent * 100).toFixed(0)}%`} />
      <Row
        label="已压缩"
        value={`${snapshot.compaction.compactionsCount} 次 · 释放 ${formatK(snapshot.compaction.totalFreed)}`}
      />
      <Row
        label="会话消耗"
        value={`${formatK(snapshot.sessionCost.inputTokens + snapshot.sessionCost.outputTokens)} tokens · $${snapshot.sessionCost.totalCostUsd.toFixed(4)}`}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
```

### 8.4 删除散落 clamp

- [Chat.tsx:1685](packages/app/components/Chat.tsx#L1685) `Math.min(100, usagePercentage)` 删除（schema 保证）
- [Chat.tsx:1788](packages/app/components/Chat.tsx#L1788) `Math.min(100, Math.max(0, ...))` 删除
- [Chat.tsx:1768](packages/app/components/Chat.tsx#L1768) 散落 `p.pct` clamp 改走 format 函数
- 全部 `usagePercentage.toFixed(0)` 直接用（schema 已保证 0-100）

---

## 9. 不变式 + 静态约束

### 9.1 4 个不变式测试（CI 必跑）

```ts
// packages/core/src/__tests__/context-invariants.test.ts
import { describe, test, expect } from 'vitest';
import { CompactionStateTracker } from '../modules/compaction/state-tracker';
import { ContextBudgetSnapshotSchema } from '../services/context/budget-schema';

describe('CompactionStateTracker invariants', () => {
  test('INV-1: compactionsCount 单调非递减', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85 });
    const s0 = t.getSnapshot();
    t.recordAttempt(0);
    t.recordResult(1000, 0);
    const s1 = t.getSnapshot();
    t.recordAttempt(1);
    t.recordResult(500, 1);
    const s2 = t.getSnapshot();

    expect(s1.compactionsCount).toBeGreaterThanOrEqual(s0.compactionsCount);
    expect(s2.compactionsCount).toBeGreaterThanOrEqual(s1.compactionsCount);
  });

  test('INV-2: totalFreed 单调非递减', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85 });
    t.recordAttempt(0); t.recordResult(1000, 0);
    const s1 = t.getSnapshot();
    t.recordAttempt(1); t.recordResult(500, 1);
    const s2 = t.getSnapshot();
    expect(s2.totalFreed).toBe(s1.totalFreed + 500);
  });

  test('INV-3: totalFreed === sum of per-step freed', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85 });
    t.recordAttempt(0); t.recordResult(1000, 0);
    t.recordAttempt(1); t.recordResult(500, 1);
    t.recordAttempt(2); t.recordResult(0, 2);  // no-op
    t.recordAttempt(3); t.recordResult(300, 3);
    expect(t.getSnapshot().totalFreed).toBe(1800);
  });

  test('INV-4: state ∈ {idle, compacting, justCompacted}', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85 });
    const valid = new Set(['idle', 'compacting', 'justCompacted']);
    for (const step of [0, 1, 2, 3, 4, 5]) {
      t.tickStep(step);
      expect(valid.has(t.getSnapshot().state)).toBe(true);
    }
  });
});

describe('ContextBudgetSnapshot schema', () => {
  test('INV-5: utilizationPercent ∈ [0, 100]', () => {
    expect(() => ContextBudgetSnapshotSchema.parse({
      utilizationPercent: 150,  // 越界
      totalTokens: 1000,
      modelLimit: 1000,
      compaction: { state: 'idle', compactionsCount: 0, totalFreed: 0, triggerPercent: 0.85 },
      sessionCost: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, totalCostUsd: 0 },
      capturedAt: new Date().toISOString(),
      source: 'live',
    })).toThrow();
  });
});
```

### 9.2 5 条 lint 规则

```yaml
# .eslintrc.yml (在 packages/app 和 packages/core 各自添加)
rules:
  no-restricted-syntax:
    - error
    # 1. 禁止静默 fallback 到累计值
    - selector: "BinaryExpression[operator='??'][right.property.name=/usagePercentage|totalTokens/]"
      message: "Don't fallback to cumulative tokens. Read estimation only."
    # 2. 禁止硬编码 128_000
    - selector: "Literal[value=128000]"
      message: "Use getModelCapabilities().contextLimit"
    # 3. 禁止 Math.min(100, ...) 在 format.ts 之外
    - selector: "CallExpression[callee.property.name='min'][arguments.0.value=100]"
      message: "Clamping must go through zod schema, not Math.min"
    # 4. 禁止 compactionActive = .* > 0
    - selector: "AssignmentExpression[left.property.name='compactionActive']"
      message: "compactionActive must read from CompactionStateTracker.getSnapshot().state"
    # 5. 禁止 as any 跨包类型逃逸
    - selector: "TSAsExpression[typeAnnotation.type='TSAnyKeyword']"
      message: "as any is type laundering. Use zod parse instead."
```

### 9.3 白名单 vs 黑名单

- 黑名单（上述 5 条）：易绕过（`as any`、字符串拼接）
- **白名单**（更可靠，待 v1 验证后加）：
  - 仅 `packages/app/components/context/format.ts` 可 import `Math` 模块
  - 仅 `CompactionStateTracker` 写 `compactionCount` / `totalFreed`
  - 仅 `buildContextBudgetPayload` 构造 SSE 事件

---

## 10. 迁移路径（4 阶段，每阶段可独立发布 + 回滚）

### 阶段 0：骨架（1-2 天）
- [ ] 新建 `packages/core/src/modules/compaction/state-tracker.ts`
- [ ] pipeline.ts 接入（**不删** reportCompaction，并行运行）
- [ ] 新建 `packages/core/src/services/context/budget-schema.ts`
- [ ] 新建 `packages/app/app/api/chat/context-payload.ts`
- [ ] **不推送新数据**（仅写日志验证 tracker 行为）
- [ ] 加 4 个 invariant test

**回滚**：纯新增模块，git revert 即可。

**验证**：`compactionsCount` / `totalFreed` 单调非递减测试通过；1000 步压测不爆。

### 阶段 1：route 改用 zod（1 天）
- [ ] route.ts 4 处 `?? summary.usagePercentage` 改为 `if (!est) return null`
- [ ] route.ts 4 处 inline 构造改用 `buildContextBudgetPayload` + `ContextBudgetSnapshotSchema.parse`
- [ ] 旧的 `data-context-usage` 字段保留兼容，新 payload 字段优先
- [ ] 灰度 1% 用户观察

**回滚**：保留旧 inline 构造在 dead code，切换 feature flag。

**验证**：invariant test、UI 视觉无变化（字段集兼容）。

### 阶段 2：UI 切换（1-2 天）
- [ ] Chat.tsx `streamContextBudget` state 类型改为 `ContextBudgetSnapshot | null`
- [ ] `ContextRing` / `ContextDetail` 上线
- [ ] 删除 `cacheHitRatio` 死字段
- [ ] 删除 `Math.min(100, ...)` 散落（仅 format.ts 保留）
- [ ] ChatPage 用新 schema 映射 DB → prop

**回滚**：prop 类型保留兼容字段；旧 fallback 链路保留。

**验证**：E2E 走通、UI 视觉回归（圆环颜色、文字位置）、ChatPage 刷新页面无 251%。

### 阶段 3：清理（1 天）
- [ ] 删除 `tokenBudget.reportCompaction`（[token-budget.ts:103-114](packages/core/src/modules/session/token-budget.ts#L103-L114)）
- [ ] 删除 `_sessionInputTokens -= tokensFreed` 逻辑
- [ ] 删除 `tokenBudget.totalTokens` / `usagePercentage` / `remainingTokens` getter
- [ ] `shouldCompact` 无参版删除，pipeline 改读 estimation
- [ ] DB schema v18 migration：新增 7 列，旧列保留
- [ ] CostTracker 增加 `getSessionCostSnapshot()` 方法

**回滚**：v18 migration 是 ALTER TABLE 加列，非破坏性；旧列保留可回滚。

**验证**：回归测试（100 个真实 session）、灰度 1% 用户 24h 监控 SSE 错误率、UI 报错率 < 0.1%。

---

## 11. 风险与监控

### 11.1 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| estimation 性能 | 低 | 中 | v1 仍用 char-estimation，足够快 |
| DB migration 阻塞 | 极低 | 高 | ALTER TABLE 加列非破坏；旧列保留 |
| UI 视觉回归 | 中 | 低 | A/B 测试 1% 用户；保留旧 UI 1 周 |
| `lastEstimation` 偶发 null | 中 | 中 | `if (!est) return null` 跳过；监控 30 天 |
| 跨包 schema 同步失败 | 低 | 高 | 单一文件 export；CI 编译时强制 |
| 状态机边界 bug | 中 | 中 | 5 个 invariant test + 灰度 |

### 11.2 监控指标

| 指标 | 阈值 | 告警 |
|---|---|---|
| SSE `data-context-usage` 推送频率 | < 1/秒 | 持续 > 5/秒 告警 |
| `utilizationPercent` > 100 出现次数 | 0 | > 0 立即告警 |
| `lastEstimation` null 在 onStepEnd 触发次数 | < 0.1% | > 1% 告警 |
| `compactionCount` 回退次数 | 0 | > 0 立即告警（invariant 违反） |
| DB 写频率 | < 1/10 步 | 持续每步写告警（旧逻辑残留） |
| 跨 schema parse 失败次数 | 0 | > 0 立即告警（schema drift） |

### 11.3 性能预期

- 当前：每步 1 次 DB 写 + 1 次 SSE 推 = 10 步对话 10 次 DB 写 + 10 次 SSE
- 重构后：10 步对话约 2-3 次 DB 写 + 2-3 次 SSE 推
- DB 写减少 70-80%，SSE 减少 70-80%

---

## 12. 验证清单（每阶段必过）

### 阶段 0 通过条件
- [ ] 4 个 invariant test 全过
- [ ] 1000 步压测不爆
- [ ] 新 tracker 输出与旧 reportCompaction 输出一致（数值差异 < 1%）

### 阶段 1 通过条件
- [ ] route.ts 4 处 inline 构造全部替换
- [ ] 旧的 `?? summary.usagePercentage` 全部删除
- [ ] 灰度 1% 用户 24h 无新增报错
- [ ] SSE 推送频率下降 ≥ 50%

### 阶段 2 通过条件
- [ ] UI 视觉回归测试通过
- [ ] ChatPage 刷新页面无 251%（DB 加载路径）
- [ ] 死字段 `cacheHitRatio` 删除
- [ ] `Math.min(100, ...)` 仅出现在 `format.ts`

### 阶段 3 通过条件
- [ ] `tokenBudget.totalTokens` / `usagePercentage` / `remainingTokens` 全部删除（编译通过 = 验证）
- [ ] DB schema v18 migration 跑通（已有 100 个 session 全部成功）
- [ ] 灰度 100% 用户 7 天无 P0 报错
- [ ] 监控指标全部在阈值内

---

## 13. 不在范围（v1 后续工单）

| 主题 | 描述 | 优先级 |
|---|---|---|
| 详情条 4 段 | messages / instructions / tools / outputReserve 分段展示 | P2 |
| Sidebar 水位圆环 | 每条会话旁的小圆环 | P3 |
| 真实 tokenizer | 替换 char-estimation 为 gpt-tokenizer | P3（性能验证后） |
| 费用展示 | `/api/chat/[chatId]/costs` 端点已有，前端未消费 | P2 |
| 压缩后 session 变化趋势 | 显示压缩前后 utilization 变化曲线 | P3 |
| 多模型 contextLimit 切换 | 不同 model 切换时水位归零或平滑过渡 | P2 |
| i18n | 数字格式化、状态徽章文案 | P3 |
| a11y | 圆环 aria 标签、颜色对比度 | P2 |

> 其中"多模型 contextLimit 切换""真实 tokenizer"与 §2.4 A4 / §14.4 联动，实施时合并处理。

---

## 14. 下一阶段实施设计：输出侧 + 外部化 + 模型主动 + 精益化（P0-P3）

> 状态：设计（📐 未实施）。设计权威：compaction-redesign.md §10（输出侧：问题定义/现状盘点/G7-9/机制设计/待调查/修复候选），本节为实施计划，不重复设计论证。业界对标见 compaction-redesign.md §11（Anthropic context engineering / MemGPT / "Let Me Take This Outside"）。
> 这四件事是压缩系统"输入侧已闭环"后的下一阶段主线，与 §2-§10 展示重构共用同一预算口径（§2.4 A1/A2）。

### 14.1 P0 — 输出侧落地（实施 compaction-redesign §10）

> 设计权威：compaction-redesign.md §10。前置：§10.6 待调查①（`finishReason` 是否暴露 `length`）决定动作 1/2 可行性，**先验证信号再动工**。

这是静默截断事故（conversation_id=`sKYk66c0Q3N5rc4EL-WIc`）的正解，也是 externalization 在输出侧的应用。四个动作：

1. **显式 `max_tokens` + 截断检测**：模型调用显式设 `maxOutputTokens`；检测 `finishReason='length'` / 文本完整性启发式（断词/未闭合结构）→ 截断的 run **不 committed**（§10.4.2）。
2. **截断后自动续写**：已产出文本（截至截断点）追加进上下文，显式要求模型"接续不重写"；上下文满则先压缩（§3-§9）再续（§10.4.3）。
3. **动态 `outputReserve` 并入 `deriveBudget`**：`capabilities.ts:100` 的静态 `min(defaultOutputTokens, 20000)` 改为随窗口余量推导（`clamp(目标, minReserve, contextLimit−输入占用)`），参与 trigger/hardLimit 推导（§10.4.1 / §10.4.4；与 §2.4 A1 同源）。
   > **实施注记（2026-08-15）**：曾试"窗口比例 15%"版——按窗口比例收紧预留，但**低估模型真实输出能力**（22.8k 窗口只预留 3420，而模型 maxOutputTokens=8000），把触发点后移、截断风险回来，且改坏小窗口调校，**已回滚**。**正确版已实施**：`outputTokensOverride`（ModelEntry.outputTokens）穿进 `estimateFullRequest`/`estimateRequestBudget`/`budget-check`/`pipeline`，`outputReserve = 每模型 outputTokens`（缺省 8000），预算与每模型 maxOutputTokens 一致。设置页 outputTokens 字段已移除，per-model 值手工写 models.json 生效。
4. **输出侧分片写（"Let Me Take This Outside" 用于产出）**：长任务让模型增量落盘、上下文只留"进度指针 + 已写范围"，而不是一次生成完——从源头消灭"写不完"（§10.4.3；与 P1 分片读对称）。

### 14.2 P1 — 外部化读回协议（补全 externalization 闭环）

现状：输入侧"落盘"有了（`unified-output.ts` 超限 → 落盘 + 预览 + filepath），但**写端/读端不对称**——模型拿到 filepath 只能用 `read_file`（有大小限制会截断），没有针对已落盘产物的分片/检索读取。

1. **范围/检索读取原语**：对持久化输出支持 `head/tail`、按行区间、`grep` 定位（渐进披露，对应 Anthropic 的 just-in-time retrieval）。
2. **指针信息增强**：落盘时在上下文里给出**文件大小、行数、结构提示**，让模型先判断再决定加载多少。
3. **落盘阈值与动态预算联动**：窗口越紧 → 更早落盘（对齐 P0 的动态 `outputReserve`，与 §2.4 A1 同一口径）。

### 14.3 P2 — 模型主动参与压缩（MemGPT 事件驱动）

把 roadmap 的 `compact_tool_result` / CompactContext（compaction-redesign §4.7、§12.3 已有完整设计）落地：

1. 模型在"探索结束、进入实现"等节点**主动释放旧工具输出**（`compress_old_outputs`），而不是等系统 85% 兜底（§12.3 有 CompactContext 工具签名 + `validateCompactionRequest` 5 规则）。
2. 结合 §4.7 的 `context_pin` 形成完整的**模型侧预算控制面**（pin 保留 + 主动释放）。

### 14.4 P3 — 质量驱动的精益化（context rot）

动机是**质量不是容量**——上下文越长召回越低（context rot），压缩不能只等触发。

1. **即使未到 trigger**，长时间无压缩时按"年龄/引用深度"清理低信号旧输出（§4.3 触发语义的补充，不改变现有水位）。
2. **压缩摘要加显式高召回保留类别**（决策 / 未决问题 / 下一步），对齐 Anthropic 的 "preserve decisions, unresolved bugs, next steps"——todos 已兜底"下一步"，摘要 prompt 显式声明这些类别。

### 14.5 与展示重构的关系

- **共用同一预算口径**：P0 动态 `outputReserve`、P1 落盘联动、显示 A1-A4 全部读 `estimation.totalTokensWithBuffer` 与 policy 刻度——显示层与引擎层不再两套数。
- **实施顺序建议**：P0（先验证截断信号）→ A1/A2（显示先同源，改动小）→ P1 → P2 → P3 → A3/A4（四态机接 UI）。

---

## 附录 A：核心代码索引

| 主题 | 文件:行 |
|---|---|
| estimation 计算 | [token-counter.ts:315-353](packages/core/src/modules/compaction/token-counter.ts#L315-L353) |
| compaction 调用 | [pipeline.ts:160-170](packages/core/src/modules/agent-control/pipeline.ts#L160-L170) |
| tracker 累计 | [token-budget.ts:30-43](packages/core/src/modules/session/token-budget.ts#L30-L43) |
| tracker 压缩扣减 | [token-budget.ts:103-114](packages/core/src/modules/session/token-budget.ts#L103-L114) |
| tracker shouldCompact | [token-budget.ts:99-101](packages/core/src/modules/session/token-budget.ts#L99-L101) |
| route 推送 SSE #1 | [route.ts:477-525](packages/app/app/api/chat/route.ts#L477-L525) |
| route 推送 SSE #2 (retry) | [route.ts:553-595](packages/app/app/api/chat/route.ts#L553-L595) |
| ChatPage prop 构造 | [ChatPage.tsx:18-34](packages/app/components/ChatPage.tsx#L18-L34) |
| Chat 圆环 + 文字 | [Chat.tsx:1685, 1698](packages/app/components/Chat.tsx#L1685) |
| Chat 详情条 clamp | [Chat.tsx:1788, 1768](packages/app/components/Chat.tsx#L1788) |
| updateContextBudget SQL | [conversation-store.ts:82-87](packages/core/src/services/datastore/sqlite/conversation-store.ts#L82-L87) |
| Conversation interface | [types.ts:90-110](packages/core/src/primitives/datastore/types.ts#L90-L110) |

## 附录 B：相关文档

- [token-usage-architecture.md](./token-usage-architecture.md) — 历次修复演进 + 审计
- [compaction-redesign.md](./compaction-redesign.md) — 上下文压缩唯一权威文档（输入侧 + 输出侧 §10 + 历史档案 §12）

---

**最后更新**：2026-08-15
**对应代码状态**：部分实施——`state-tracker.ts`（§3）与 `budget-schema.ts`（§5）已落地；SSE 全快照/四态机 UI 消费（§2.4 A3）与 §14 输出侧/外部化/模型主动/精益化未实施
