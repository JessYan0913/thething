# 上下文压缩系统减负重构实施计划

> 状态：计划阶段（已基于代码实际情况修正）
> 目标：加老化、修正逻辑、增加可见性——不减效果
> 前次计划已核对全部 17 个源文件，以下方案与代码现状一致

## 不变项（绝不改动）

以下四条不变量及 Key/Value 分离架构保持不动：

1. 感知-行动环不可断（当前步结果永不 meta）— `lifecycle.ts:140-143`
2. Key 永不被驱逐（工具调用输入在所有压缩路径保留全文）— `lifecycle.ts` 补丁 only 替换 output
3. 语义类工具超大截断不 meta — `lifecycle.ts:152` 的 `isSemanticTool` 分支
4. 读循环熔断（同文件 >= 3 次自动 pin）— `lifecycle.ts:492-522` 的 `detectReadLoops`

**代码现状关键发现**：

- `manageCompaction`（lifecycle.ts:865-913）已经是统一分配器——Layer 2 后 estimate → 超限调 `applyEmergencyCompression`
- `applyEmergencyCompression`（lifecycle.ts:919-1000）内收口了全部紧急路径：确定性摘要 → LLM 摘要 → 强制截断
- `compactBeforeStep`（index.ts:32-92）只做 selfHeal → compactionView → manageCompaction 三步编排
- `compressMessagesDeterministic` 和 `forceTruncateMessages` 同驻 `message-compressor.ts`，但本质是两个独立功能：前者做消息级确定性压缩，后者做保底截断。两者都被 `applyEmergencyCompression` 调用
- `budget-check.ts` 有自己的降级链：Layer 2 激进 → Emergency → 工具过滤 → 极简模式，会独立调用 `applyEmergencyCompression`
- `CompactionTelemetry` 有 8 种事件类型但无 UI 推送，`ContextLedger` 有 `formatLedger` 和 `recordCompaction` 但无 `recordEviction`
- pipeline.ts:199 调用 `sessionState.compact()`，gate.ts 在 pipeline.ts:207-227 做最终闸门校验

---

## Phase 1 — 代码重组（无功能变更）

**注意**：原计划的"合并 Layer 2.5 进 Layer 2"已由代码现状实现——`manageCompaction` 已是唯一入口。此 Phase 改为纯粹的代码重组。

**目标**：减少模块耦合，让每个文件职责单一。

### 步骤 1.1：拆分 message-compressor.ts

`message-compressor.ts` 包含两个功能迥异的函数：
- `compressMessagesDeterministic`（第 45-123 行）：消息级确定性压缩，只被 `applyEmergencyCompression` 调用
- `forceTruncateMessages`（第 257-313 行）：强制截断保底，被 `applyEmergencyCompression` 和 `budget-check.ts:127` 两处调用

拆分为：
```
message-compressor.ts  → force-truncate.ts       （forceTruncateMessages）
lifecycle.ts           ← integrateDeterministic   （compressMessagesDeterministic 移至 lifecycle.ts 内部，与 applyEmergencyCompression 同文件，减少跨文件 import）
```

**不改任何逻辑**，不改变量名，不改变行为。只改 import 路径。

### 步骤 1.2：index.ts 清理导出

```typescript
// 删除
export { compressMessagesDeterministic, forceTruncateMessages } from './message-compressor';
// 改为
export { forceTruncateMessages } from './force-truncate';
// compressMessagesDeterministic 不再对外导出（仅 lifecycle.ts 内部使用）
```

### 验证标准

- 所有现有测试通过（只改 import 路径）
- `npm run typecheck` 通过
- 无新增 TS 错误

---

## Phase 2 — Meta 消息 TTL 老化

**目标**：meta 化消息随年龄自动降级，长对话碎片从 O(n) 降到 O(1)。

**代码锚点**：TTL 逻辑插入在 `manageToolOutputLifecycle` 的消息遍历循环（lifecycle.ts:104 行 `messages.map` 回调）中。当前已 meta 的消息在第 111 行 `if (v.toolResults.every((tr) => tr.isCompacted)) return msg;` 被跳过——TTL 在此分支内新增年龄检查。

### 步骤 2.1：消息元数据扩展

`ToolResultItemView`（message-view.ts:30-51）已有 `isCompacted` 标记，但没有年龄。扩展方式：在补丁写入时附带时间戳。

```typescript
// types.ts 新增
export interface CompactionMeta {
  compactedAt: number;     // 压缩时的消息索引（步数）
}

// CompactedToolResult 扩展
export interface CompactedToolResult {
  summary: string;
  _compacted: true;
  _originalSize: number;
  _compactedAt: number;    // 新增：压缩步数（来自 lifecycle.ts 的 compactedAtCounter）
}
```

### 步骤 2.2：lifecycle.ts 增加步数计数器

`manageToolOutputLifecycle` 前加一个闭包变量：

```typescript
let compactedAtCounter = 0; // 每轮压缩递增

// 在 buildMetaPatch/buildTruncationPatch 中：
patches.push({ refIndex: tr.refIndex, summary, mode: 'compacted', compactedAt: compactedAtCounter++ });
```

### 步骤 2.3：TTL 老化逻辑

在 `manageToolOutputLifecycle` 的消息遍历中，第 111 行的 `isCompacted` 跳过逻辑改为：

```typescript
if (v.toolResults.every((tr) => tr.isCompacted)) {
  // TTL 检查：所有已压缩 → 判断是否需要进一步降级
  const oldestAge = Math.min(...v.toolResults.map(t => t._compactedAt ?? Infinity));
  if (oldestAge === Infinity) return msg; // 无 _compactedAt，保持

  const age = compactedAtCounter - oldestAge; // 年龄

  if (age > 40) {
    // Level 3: 移除消息，记录到台账
    opts?.ledger?.recordEviction?.(...);
    return null; // null 在 filter 中移除
  }

  if (age > 20) {
    // Level 2: 替换为一行占位符
    const stubMsg = buildStubMessage(msg); // "[step N: compressed tool output — archived]"
    return stubMsg;
  }

  // Level 1: age <= 20，保持不变
  return msg;
}
```

最后过滤掉 null：
```typescript
const filteredResult = result.filter((m) => m !== null);
```

### 步骤 2.4：ContextLedger 新增 recordEviction

```typescript
// context-ledger.ts 新增方法
recordEviction(msg: ModelMessage, reason: 'ttl'): void {
  // 记录被 TTL 移除的消息概要，供模型用 context_pin 找回
  this.evictions.push({ at: Date.now(), messageId: msg.id, reason });
}
```

### 验证标准

- 模拟 100 步对话，验证 meta 碎片 token 保持在 O(1) 量级
- 被移除的消息可通过 `context_pin list` 找回
- 读循环熔断检测（lifecycle.ts:492-522）在 TTL 移除后仍正常——因为熔断统计基于 view 而非消息存在性
- 所有现有 lifecycle 测试通过

---

## Phase 3 — Checkpoint 改为步数触发

**目标**：Checkpoint 从"几乎不触发"变成确定性触发。

**代码锚点**：`maybeCheckpointAfterRun`（checkpoint.ts:125-204），当前第 145 行 `if (!context.force && totalTokens < contextLimit * CHECKPOINT_TRIGGER_PERCENT) return false;` 是导致几乎不触发的根因。

### 步骤 3.1：新增步数触发条件

修改 `checkpoint.ts` 的 `maybeCheckpointAfterRun` 签名和逻辑：

```typescript
// 新增参数
const CHECKPOINT_STEP_THRESHOLD = 20;
const CHECKPOINT_COMPACTION_THRESHOLD = 3;

export async function maybeCheckpointAfterRun(
  activeMessages: UIMessage[],
  context: {
    // ... 原有字段
    stepCount?: number;           // 新增：当前步数
    compactionCount?: number;     // 新增：本会话压缩次数
  },
): Promise<boolean> {
  // 原有水位判断改为 OR 条件
  const contextLimit = getModelContextLimit(context.modelName, context.contextLimit);
  const totalTokens = await estimateMessagesTokens(...);

  // 新增确定性触发
  const stepTriggered = (context.stepCount ?? 0) > CHECKPOINT_STEP_THRESHOLD;
  const compactionTriggered = (context.compactionCount ?? 0) > CHECKPOINT_COMPACTION_THRESHOLD;
  const waterlineTriggered = totalTokens >= contextLimit * CHECKPOINT_TRIGGER_PERCENT;

  // force=true 保留（自愈场景），但水位线条件改为 OR
  if (!context.force && !stepTriggered && !compactionTriggered && !waterlineTriggered) {
    return false;
  }
  // ... 后续逻辑不变
}
```

### 步骤 3.2：从 finalize.ts 传入步数/压缩计数

调用方（`packages/core/src/composition/finalize.ts`）在调用 `maybeCheckpointAfterRun` 时传入步数和压缩次数。

### 步骤 3.3：调整 CHECKPOINT_KEEP_PERCENT

步数触发比水位线触发早，保留比例可以放宽：

```typescript
// 之前：CHECKPOINT_KEEP_PERCENT = 0.30（触发晚，不得不激进）
// 之后：CHECKPOINT_KEEP_PERCENT = 0.50（触发早，多保留上下文）
```

### 步骤 3.4：selfHealOrphanedCheckpoint 保持 force=true

自愈场景（checkpoint.ts:232-279）的 force=true 保留不删——孤儿锚点/旧格式自愈是独立机制，与常规触发逻辑无关。

### 验证标准

- 20 步以上的 Agent 运行必定触发 checkpoint
- checkpoint 摘要在 `applyCheckpointOnLoad` 中正确恢复
- 孤儿锚点自愈（`selfHealOrphanedCheckpoint`）在 force=true 下正常工作
- `finalizeAgentRun` 正确传入新增参数

---

## Phase 4 — 压缩过程用户可见

**目标**：用户在对话流中感知压缩发生。

**代码现状**：`CompactionTelemetry`（compaction-telemetry.ts）已有 8 种事件类型和 `getStats()`/`getRecentEvents()` 方法，但无 UI 推送。压缩完全静默。

### 步骤 4.1：扩展 CompactionTelemetry 添加事件发射器

```typescript
// compaction-telemetry.ts 新增
export type CompactionUICallback = (event: CompactionUINotification) => void;

export interface CompactionUINotification {
  layer: 'lifecycle' | 'emergency';
  messagesAffected: number;
  tokensSaved: number;
  strategy: 'meta' | 'truncate' | 'summarize' | 'force-truncate' | 'ttl-stub' | 'ttl-evict';
  durationMs: number;
}

export class CompactionTelemetry {
  private uiCallbacks: CompactionUICallback[] = [];

  onCompactionUI(cb: CompactionUICallback): void {
    this.uiCallbacks.push(cb);
  }

  notifyUI(notification: CompactionUINotification): void {
    for (const cb of this.uiCallbacks) this.cb(notification);
  }
}
```

### 步骤 4.2：在 lifecycle.ts 压缩完成后推送 UI 事件

在 `manageCompaction` 返回前推送：

```typescript
// manageCompaction (lifecycle.ts:865) 返回前
context.telemetry?.notifyUI({
  layer: 'lifecycle',
  messagesAffected: messages.length - current.length,
  tokensSaved: tokensFreed,
  strategy: 'meta',
  durationMs: Date.now() - startTime,
});
```

在 `applyEmergencyCompression` 各档位（确定性/LLM/截断）成功后推送对应的 strategy 事件。

### 步骤 4.3：SessionState 连接 UI 事件

```typescript
// state.ts 中
const telemetry = new CompactionTelemetry();
telemetry.onCompactionUI((notification) => {
  // 写入会话消息流作为系统消息
  sessionMessages.push(createCompactionUIMessage(notification));
});

// 通过 compactionConfig 传入 telemetry
compactBeforeStep(messages, compactionConfig, { ..., telemetry });
```

### 步骤 4.4：UI 组件

在 App 包的 Chat 组件中渲染系统消息：

```
[系统] 上下文压缩完成
├── 模式: 精简归档
├── 影响: 5 条历史消息
└── 释放: 12,000 tokens
```

- 不可交互，仅展示
- 颜色：灰色系统消息风格
- 策略映射：
  - `meta` → "N 条消息输出已精简归档"
  - `ttl-stub` → "N 条过期消息已归档"
  - `ttl-evict` → "N 条消息已从上下文移除"
  - `truncate` / `force-truncate` → "上下文超出限制，已截断早期消息"
  - `summarize` → "历史对话已生成摘要"
- 如果 4.2 之后 `messagesAffected === 0`，不推送（避免无意义消息）

### 步骤 4.5：上下文用量指示器（可选）

复用 pipeline.ts:219 已有的 `sessionState.updateContextBudget?.(estimation)` 数据，在输入框上方渲染进度条。

### 验证标准

- 每次压缩触发后，对话流中出现对应的系统消息
- messagesAffected === 0 时不推送
- 系统消息不可交互、不影响对话流正常使用

---

## 实施顺序与依赖

```
Phase 1 (代码重组)
  │
  ├──> Phase 2 (TTL 老化)  ← 依赖 Phase 1 拆分后的 lifecycle.ts
  │
  ├──> Phase 3 (Checkpoint) ← 与 Phase 2 无依赖，可并行
  │
  └──> Phase 4 (可见性)     ← 依赖 Phase 2 的 TTL 策略类型 + Phase 1 的 telemetry 扩展
```

Phase 1 可独立合并，Phase 2/3 可并行开发，Phase 4 最后。

---

## 风险与回滚

| 风险 | 缓解措施 |
|------|----------|
| Phase 1 重组导致 import 错误 | TS 编译 + 全量测试即发现，零运行时风险 |
| Phase 2 TTL 过早移除关键信息 | context_pin + ContextLedger 可找回；age > 40 步的移除阈值保守 |
| Phase 2 TTL 破坏读循环熔断 | 熔断统计基于 view 索引，不依赖消息是否在数组中 |
| Phase 3 步数触发导致过多 checkpoint | CHECKPOINT_COMPACTION_THRESHOLD = 3 作为阻尼，且 checkpoint 生成是后台异步 |
| Phase 4 UI 事件性能 | 事件节流（同一压缩操作的最多推送 1 次；messagesAffected === 0 不推） |

每个 Phase 独立可回滚——改动在各自模块内，不形成跨 Phase 强耦合。

---

## 成功度量

| 指标 | 当前 | 目标 |
|------|------|------|
| 压缩核心文件数 | 18 | <= 15 |
| 长对话（100+ 步）meta 碎片 | O(n) ~4000 tokens | O(1) ~500 tokens |
| Checkpoint 实际触发率 | <5% | 100%（>20 步任务） |
| 用户可感知压缩发生 | 否 | 是（系统消息） |
| 测试全量通过 | 已有的通过 | 全部通过 + 新增 TTL 测试 |
