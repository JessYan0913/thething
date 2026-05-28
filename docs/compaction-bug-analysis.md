# 上下文压缩系统 Bug 分析

## 1. 问题现象

用户配置了 `contextLimit`（如 12.8k 或 22.8k），但上下文压缩从未实际执行。

日志表现：
```
[Context] █████████████████░░░ 85.1% (19.4k/22.8k) ⚠ TRIGGER │ msgs 1.1k │ sys 1.0k │ tools 9.2k │ out 8.0k
[Context] █████████████████░░░ 85.2% (19.4k/22.8k) ⚠ TRIGGER │ msgs 1.2k │ sys 1.0k │ tools 9.2k │ out 8.0k
```

Context bar 连续显示 `⚠ TRIGGER`，百分比持续上升，**没有出现 `[Agent] Compaction freed X tokens` 日志**，说明压缩未执行。

## 2. 根因分析

### 2.1 Bug #1：Budget check 忽略用户配置的 contextLimit

**数据流追踪：**

```
create.ts:195 → checkInitialBudget(messages, instructions, tools, modelName, ...)
  → budget-check.ts:69 → estimateFullRequest(messages, instructions, tools, modelName)
    → token-counter.ts:242 → getModelCapabilities(modelName)  // 无 contextLimitOverride
      → capabilities.ts:86 → getModelContextLimit(modelName)  // 无 limitOverride
        → 返回 DEFAULT_CONTEXT_LIMIT = 128_000
```

`estimateFullRequest` 不接受 `contextLimitOverride` 参数，始终使用模型默认值 128k。而 `getModelCapabilities` 已支持 `options.contextLimitOverride`，只是 `estimateFullRequest` 没有透传。

**对比 pipeline 和 compactBeforeStep：**

| 消费者 | contextLimit 来源 | 实际值 |
|--------|-------------------|--------|
| Budget check (`budget-check.ts:69`) | `estimateFullRequest` → 模型默认 | 128,000 |
| Context bar (`pipeline.ts:112`) | `getModelContextLimit(model, config.contextLimit)` | 用户配置值 |
| compactBeforeStep (`index.ts:58`) | `getModelContextLimit(modelName, context.contextLimit)` | 用户配置值 |

**后果：** 用户配置 `contextLimit: 22800`，budget check 以 128k 判断 → 15% 利用率 → 放行。但实际可用空间只有 22.8k，请求已接近超限。

**具体影响展开：** Budget check 内部各 Strategy 的阈值全部失真：

| Strategy | 触发条件 | 以 128k 计算 | 以 22.8k 计算 | 后果 |
|----------|---------|-------------|-------------|------|
| Strategy 1 (Layer 2) | `messagesTokens > modelLimit * 0.2` | > 25,600 | > 4,560 | 阈值 25.6k 已超过用户整个 contextLimit，历史对话加载时 Strategy 1 几乎不可能触发 |
| Strategy 2 (Tool filter) | `toolsTokens > modelLimit * 0.10` | > 12,800 | > 2,280 | 9.2k 的工具定义本应触发过滤（> 2.28k），却被 12.8k 阈值放行 |
| Strategy 3 (LLM summary) | `messagesTokens > modelLimit * 0.3` | > 38,400 | > 6,840 | 同理，阈值远高于用户实际可用空间 |

### 2.2 Bug #2：compactBeforeStep Layer 3 触发条件错误

**代码位置：** `compaction/index.ts:57-61`

```typescript
const estimation = await estimateFullRequest(current, '', {}, context.modelName);  // 空指令、空工具
const contextLimit = getModelContextLimit(context.modelName, context.contextLimit);
const triggerTokens = Math.floor(contextLimit * config.contextWindow.triggerPercent);  // 22800 * 0.85 = 19380

if (estimation.messagesTokens >= triggerTokens) {  // 1100 >= 19380 → false，永不触发
```

**问题：** 触发条件只检查 `messagesTokens`，要求它达到**整个 contextLimit 的 85%**。但消息的实际可用空间只有：

```
available = contextLimit - instructions - tools - outputReserve
         = 22800 - 1000 - 9200 - 8000
         = 4600
```

消息永远无法在 4600 的可用空间内达到 19380 的阈值。

**对比 Context bar 的 TRIGGER 判断（`pipeline.ts:140`）：**

```typescript
// Context bar 用总量判断
const used = msgs + sys + tools + out;  // 1.1k + 1.0k + 9.2k + 8.0k = 19.3k
pct = used / contextLimit;              // 19.3k / 22.8k = 84.6%
pct >= 0.85 → 显示 ⚠ TRIGGER
```

**两个触发逻辑不一致：**
- Context bar: `(msgs + sys + tools + out) / limit >= 85%` — 总量 vs 限制
- compactBeforeStep: `msgs / limit >= 85%` — 仅消息 vs 限制

Context bar 的 TRIGGER 只是视觉标签，不触发任何操作。用户看到 TRIGGER 以为压缩会执行，实际上不会。

### 2.3 Bug #3：Budget check Strategy 3 未向 enforceContextWindow 传递 contextLimit

**代码位置：** `compaction/budget-check.ts:122-129`

```typescript
const windowResult = await enforceContextWindow(currentMessages, {
  model: context.model,
  fallbackModels: context.fallbackModels,
  modelName,
  conversationId: context.conversationId,
  dataStore: context.dataStore!,
  config: config.contextWindow,
  // ← contextLimit 缺失
});
```

**对比 compactBeforeStep 的调用（`index.ts:62-70`）：**

```typescript
const windowResult = await enforceContextWindow(current, {
  // ...
  config: config.contextWindow,
  contextLimit: context.contextLimit,  // ← 有传
});
```

**后果：** 即使修复 Bug #1 给 `checkInitialBudget` 加了 `contextLimit` 字段，Strategy 3 调用 `enforceContextWindow` 时仍不会转发，`enforceContextWindow` 内部 `getModelContextLimit` 回退到模型默认值 128k。这是修复 Bug #1 时极易遗漏的一环。

### 2.4 Bug #4：enforceContextWindow 使用零值开销

**代码位置：** `compaction/context-window.ts:72-83`

```typescript
const estimation = await estimateFullRequest(messages, '', {}, context.modelName);  // 空指令、空工具
// → estimation.instructionsTokens = 0
// → estimation.toolsTokens = 0

// guard 条件（同样有 Bug #2 的问题）
if (estimation.messagesTokens < triggerTokens) {
  return { messages, executed: false, tokensFreed: 0 };
}

// target 计算使用了零值
const targetMessageTokens = Math.max(0, targetTokens
  - estimation.instructionsTokens    // 0 (应为 ~1000)
  - estimation.toolsTokens           // 0 (应为 ~9200)
  - estimation.outputReserve);       // 正确 (~8000)
```

**后果：**
- Guard 条件与 Bug #2 相同，即使修复 Bug #2 让 compactBeforeStep 正确触发，enforceContextWindow 内部的 guard 仍会拦截
- Target 计算偏高（没有扣除真实的 instructions/tools 开销），压缩不够激进

**正确 vs 错误的 target 计算（以 limit=22.8k 为例）：**

```
错误: targetMessageTokens = 22800 * 0.6 - 0 - 0 - 8000 = 5680
正确: targetMessageTokens = 22800 * 0.6 - 1000 - 9200 - 8000 = -4520 → 0
```

**`targetMessageTokens = 0` 的边界情况：**

修正后的计算揭示了一个更深层的问题：当 `contextLimit` 较小且固定开销（instructions + tools + outputReserve）占比过高时，消息可用预算可能为零。

以 `limit=22.8k` 为例：
- 固定开销 = 1000 + 9200 + 8000 = 18,200（占 79.8%）
- `targetPercent=0.60` → `targetTokens=13,680`
- `targetMessageTokens = max(0, 13680 - 18200) = 0`

`targetMessageTokens = 0` 时 `findSplitIndex` 会将 `splitIndex` 推到接近消息末尾，几乎所有历史消息都被摘要化，只保留最后 1-2 条。如果每步都触发，会导致对话上下文快速退化为一串摘要。

**建议处理方式：**

```typescript
// 在 enforceContextWindow 中增加最小消息预算保护
const MIN_MESSAGE_BUDGET_TOKENS = 2000;
const targetMessageTokens = Math.max(MIN_MESSAGE_BUDGET_TOKENS, targetTokens
  - realInstructions - realTools - estimation.outputReserve);

// 如果即使最小预算也无法满足，发出警告
if (targetTokens - realInstructions - realTools - estimation.outputReserve < MIN_MESSAGE_BUDGET_TOKENS) {
  logger.warn('Context', `contextLimit ${contextLimit} too small for current overhead `
    + `(instructions=${realInstructions}, tools=${realTools}, output=${estimation.outputReserve}). `
    + `Message budget forced to minimum ${MIN_MESSAGE_BUDGET_TOKENS}.`);
}
```

### 2.5 附加问题：`compactBeforeStep` context 类型已定义但未被填充

**代码位置：** `compaction/index.ts:39-40`

```typescript
context: {
  // ...
  instructionsTokens?: number;  // 已定义为可选
  toolsTokens?: number;         // 已定义为可选
  contextLimit?: number;        // 已定义为可选
}
```

`compactBeforeStep` 的类型签名**已经预留了**这三个可选字段，但 `create.ts` 调用时只传了 `contextLimit`：

```typescript
// create.ts:136-143 — 当前调用
const afterResult = await compactBeforeStep(msgs, sessionState, compactionCfg, {
  model: sessionState.compactModel,
  fallbackModels: sessionState.fallbackModels,
  modelName: sessionState.model,
  conversationId,
  dataStore: sessionState.dataStore,
  contextLimit: sessionOptions.maxContextTokens,
  // instructionsTokens: ← 未传，值为 undefined
  // toolsTokens:        ← 未传，值为 undefined
});
```

而 `enforceContextWindow` 的 context 类型**不接受** `instructionsTokens`/`toolsTokens`，需要新增字段。

修复链路：`create.ts` 补传值 → `compactBeforeStep` 转发 → `enforceContextWindow` 类型新增 + 使用。

### 2.6 附加问题：Pipeline TRIGGER_PERCENT 硬编码与 config 不一致

**代码位置：** `agent-control/pipeline.ts:127`

```typescript
const TRIGGER_PERCENT = 0.85;  // 硬编码常量
```

Context bar 的 `⚠ TRIGGER` 标记使用这个硬编码值，而非读取 `config.contextWindow.triggerPercent`。如果用户自定义了 `triggerPercent`（比如 0.75），context bar 仍在 85% 时才显示 TRIGGER，但实际压缩在 75% 就应该触发。

**影响级别：** 低（不影响压缩功能，只影响用户对触发时机的感知）。

**修复：** `TRIGGER_PERCENT` 应从 pipeline config 中读取，或统一引用 `DEFAULT_CONTEXT_WINDOW_CONFIG.triggerPercent`。

### 2.7 附加问题：`getAutoCompactThreshold` / `getEffectiveContextBudget` 未接入压缩管线

**代码位置：** `services/model/capabilities.ts:95, 108`

```typescript
export function getEffectiveContextBudget(contextLimit, outputTokens): number {
  return contextLimit - Math.min(outputTokens, 20_000);
}

export function getAutoCompactThreshold(contextLimit, outputTokens): number {
  return getEffectiveContextBudget(contextLimit, outputTokens) - AUTOCOMPACT_BUFFER_TOKENS; // 13_000
}
```

这两个函数从命名和逻辑上是为压缩触发设计的——计算扣除 output reserve 和缓冲区后的有效预算。但压缩管线（`compactBeforeStep`、`enforceContextWindow`、`budget-check`）**没有调用它们**，仅通过 barrel 文件导出给外部消费者。

**影响级别：** 不影响当前修复。但标记为潜在的代码意图与实现不一致，未来如果需要更精细的触发控制可以考虑接入。

## 3. 四个 Bug 的联动效应

```
用户配置 contextLimit: 22800
           │
           ▼
┌─── Budget check (Bug #1) ──────────────────────────┐
│ 用 128k 限制判断 → 15% → 放行                      │
│ 应该用 22.8k → 79% → 可能触发 tool filtering        │
│                                                    │
│ Strategy 1 阈值 25.6k > 整个 contextLimit 22.8k    │
│ Strategy 2 阈值 12.8k → 9.2k 工具未被过滤          │
└────────────────────────────────────────────────────┘
           │
           ▼ 对话进行中...
           │
┌─── compactBeforeStep (Bug #2) ────────────────────┐
│ 消息 1.1k < 阈值 19.4k → Layer 3 不触发            │
│ 应该检查总量 19.3k >= 阈值 19.4k → 触发            │
└────────────────────────────────────────────────────┘
           │
           ▼ 即使修复 Bug #2...
           │
┌─── Budget check → enforceContextWindow (Bug #3) ──┐
│ Strategy 3 调用 enforceContextWindow 时            │
│ 未传 contextLimit → 回退 128k → 阈值失真            │
└────────────────────────────────────────────────────┘
           │
           ▼ 即使修复 Bug #2 + #3...
           │
┌─── enforceContextWindow 内部 (Bug #4) ────────────┐
│ 内部 guard 重复 Bug #2 的错误条件 → 拦截            │
│ target 计算用零值开销 → 压缩不够激进                │
└────────────────────────────────────────────────────┘
           │
           ▼
上下文持续膨胀，API 调用最终因 context_length_exceeded 失败
→ reactive retry（retry.ts）尝试补救，但已经太晚
```

## 4. 修复方案

### 4.1 `estimateFullRequest` 接受 contextLimitOverride

**文件：** `packages/core/src/modules/compaction/token-counter.ts`

```typescript
export async function estimateFullRequest(
  messages: UIMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string,
  contextLimitOverride?: number,  // 新增
): Promise<FullRequestEstimation> {
  const caps = getModelCapabilities(modelName, { contextLimitOverride });
  // caps.contextLimit 现在优先使用 override
  // 后续 modelLimit, exceedsLimit, availableBudget, utilizationPercent 自然正确
}
```

`getModelCapabilities` 已支持 `contextLimitOverride`，只需在 `estimateFullRequest` 透传。

### 4.2 `checkInitialBudget` 传递 contextLimit

**文件：** `packages/core/src/modules/compaction/budget-check.ts`

```typescript
export async function checkInitialBudget(
  messages, instructions, tools, modelName, config,
  context?: {
    dataStore?: DataStore;
    conversationId?: string;
    model?: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    contextLimit?: number;  // 新增
  },
) {
  // 所有 estimateFullRequest 调用传入 context?.contextLimit
  const initialEstimation = await estimateFullRequest(
    messages, instructions, tools, modelName, context?.contextLimit
  );
  // ... 后续 5 处 estimateFullRequest 调用同样传入
  
  // Strategy 3: enforceContextWindow 调用也传入 contextLimit
  const windowResult = await enforceContextWindow(currentMessages, {
    ...existingContext,
    contextLimit: context?.contextLimit,  // 新增 — 修复 Bug #3
  });
}
```

### 4.3 `compactBeforeStep` 修正触发条件

**文件：** `packages/core/src/modules/compaction/index.ts`

```typescript
// 当前（错误）
const estimation = await estimateFullRequest(current, '', {}, context.modelName);
const triggerTokens = Math.floor(contextLimit * config.contextWindow.triggerPercent);
if (estimation.messagesTokens >= triggerTokens)

// 修正为：用总量判断
const estimation = await estimateFullRequest(current, '', {}, context.modelName);
const contextLimit = getModelContextLimit(context.modelName, context.contextLimit);
const overhead = (context.instructionsTokens ?? 0)
  + (context.toolsTokens ?? 0)
  + estimation.outputReserve;
const totalEstimate = estimation.messagesTokens + overhead;
const triggerTokens = Math.floor(contextLimit * config.contextWindow.triggerPercent);

if (totalEstimate >= triggerTokens) {
  const windowResult = await enforceContextWindow(current, {
    ...existingContext,
    instructionsTokens: context.instructionsTokens,  // 新增
    toolsTokens: context.toolsTokens,                // 新增
  });
}
```

### 4.5 `enforceContextWindow` 接收真实开销

**文件：** `packages/core/src/modules/compaction/context-window.ts`

```typescript
export async function enforceContextWindow(
  messages: UIMessage[],
  context: {
    // ...existing...
    instructionsTokens?: number;  // 新增
    toolsTokens?: number;         // 新增
  },
) {
  const estimation = await estimateFullRequest(messages, '', {}, context.modelName);
  const contextLimit = getModelContextLimit(context.modelName, context.contextLimit);

  // Guard：使用总量判断（与 compactBeforeStep 一致）
  const realInstructions = context.instructionsTokens ?? 0;
  const realTools = context.toolsTokens ?? 0;
  const overhead = realInstructions + realTools + estimation.outputReserve;
  const totalEstimate = estimation.messagesTokens + overhead;
  const triggerTokens = Math.floor(contextLimit * config.triggerPercent);

  if (totalEstimate < triggerTokens) {
    return { messages, executed: false, tokensFreed: 0 };
  }

  // Target：使用真实开销，增加最小消息预算保护
  const MIN_MESSAGE_BUDGET_TOKENS = 2000;
  const targetTokens = Math.floor(contextLimit * config.targetPercent);
  const rawBudget = targetTokens - realInstructions - realTools - estimation.outputReserve;
  const targetMessageTokens = Math.max(MIN_MESSAGE_BUDGET_TOKENS, rawBudget);

  if (rawBudget < MIN_MESSAGE_BUDGET_TOKENS) {
    logger.warn('Context', `contextLimit ${contextLimit} too small for overhead, `
      + `message budget forced to minimum ${MIN_MESSAGE_BUDGET_TOKENS}`);
  }
}
```

### 4.6 `create.ts` 串联修改

**文件：** `packages/core/src/composition/app/create.ts`

需要调整代码顺序：

```
① sessionState.compactModel = modelInstance
② compactionCfg 定义
③ budget check（传入 contextLimit: sessionOptions.maxContextTokens）
④ finalTools = budgetCheck.adjustedTools ?? tools
⑤ 预计算 instructionsTokens, toolsTokens（用 finalTools + modelName）
⑥ sessionState.compact 定义（传入 instructionsTokens, toolsTokens）
⑦ pipeline 创建
```

当前顺序是 ①②⑥③④⑦，compact 在 budget check 之前。
需要改为 ①②③④⑤⑥⑦，确保 compact 使用 budget check 后的 finalTools 计算开销。

## 5. 验证方法

### 5.1 Budget check 修复验证

配置 `contextLimit: 12800`，启动对话：

```
修复前: [Budget] Limit: 128000 → ✅ OK (15%)
修复后: [Budget] Limit: 12800 → ⚠ Exceeds (141%) → 触发 Strategy 2 (tool filtering)
```

### 5.2 compactBeforeStep 修复验证

配置 `contextLimit: 22800`，进行多轮对话：

```
修复前: [Context] 85.1% ⚠ TRIGGER → 下一步仍是 85%+
修复后: [Context] 85.1% ⚠ TRIGGER → [Agent] Compaction freed X tokens → 下一步 < 85%
```

### 5.3 Budget check Strategy 3 修复验证

加载大型历史对话（`messagesTokens > contextLimit * 0.3`），触发 Strategy 3：

```
修复前: enforceContextWindow 内部用 128k 计算 → guard/target 失真
修复后: enforceContextWindow 用用户配置的 contextLimit → 正确触发和压缩
```

### 5.4 enforceContextWindow 修复验证

消息积累到触发压缩后，检查：
- 出现 `[Previous conversation summary]` 消息
- 消息数量减少
- Context 百分比下降到 targetPercent (60%) 附近

## 6. 影响范围

| 文件 | 改动类型 |
|------|----------|
| `packages/core/src/modules/compaction/token-counter.ts` | 函数签名加参数（Bug #1） |
| `packages/core/src/modules/compaction/budget-check.ts` | context 加 `contextLimit` 字段 + 5 处 `estimateFullRequest` 传参 + Strategy 3 转发 `contextLimit`（Bug #1, #3） |
| `packages/core/src/modules/compaction/index.ts` | 触发条件重写为总量判断 + 转发 `instructionsTokens`/`toolsTokens`（Bug #2） |
| `packages/core/src/modules/compaction/context-window.ts` | context 加 `instructionsTokens`/`toolsTokens` 字段 + guard/target 修正 + 最小消息预算保护（Bug #4） |
| `packages/core/src/composition/app/create.ts` | 代码顺序调整 + 预计算开销 + 补传 `instructionsTokens`/`toolsTokens`/`contextLimit`（串联） |
| `packages/core/src/modules/agent-control/pipeline.ts` | `TRIGGER_PERCENT` 改为读取 config（附加问题 2.6，可选） |

所有改动均为内部模块，不影响外部 API。`estimateFullRequest` 新增参数为可选，向后兼容。

## 7. 与"触发断层"分析的交叉评估

以下对另一份分析中提出的问题逐一评估，区分 **bug（必须修）**、**设计局限（可改进）** 和 **误判（无需修改）**。

### 7.1 "20%-85% 区间无压缩" — 误判，是 Bug #2 的表现

这个描述混淆了不同层的职责：

- **Layer 2 每步都执行**，只要工具输出超过 3 轮或 >8000 字符就压缩。它不受百分比阈值控制，不存在"20%以下才工作"的限制。
- **Layer 3 的 85% 阈值本身是合理的**——问题不是阈值太高，而是 Bug #2 导致阈值计算用 `messagesTokens` 而非总量，使得 85% 永远不可达。

修复 Bug #2 后，Layer 3 在总量达到 85% 时正确触发，"死区"自然消除。无需增加中间层。

### 7.2 "纯文本对话无压缩" — Bug #2 的推论，非独立问题

Layer 2 设计上只处理工具输出（`hasToolParts` 检查），这是正确的——它的机制是 `extractToolMeta`，不适用于文本消息。

**Layer 3（LLM 摘要）就是用来压缩文本对话的机制。** 但因为 Bug #2，触发条件要求 `messagesTokens >= contextLimit * 85%`。以 128k 限制为例，纯文本需要累积到 ~108k tokens 才触发——这在大多数对话中不可能达到。

修复 Bug #2（用总量判断）后，文本消息 + 固定开销的总和达到 85% 即触发 Layer 3 摘要，纯文本对话的压缩恢复正常。

### 7.3 "小工具输出（<200字符）不压缩" — 设计决策，优先级低

`lifecycle.ts:156` 的 200 字符阈值是有意设计：

```typescript
if (originalSize < 200) return part;  // 压缩元信息可能比原文更长
```

压缩后的 `CompactedToolResult` 包含 `summary`、`_compacted`、`_originalSize` 字段，元数据本身约 80-150 字符。对 <200 字符的输出，压缩后可能反而更大。

**累积效应评估：** 100 次小工具调用 * 100 字符 = 10k 字符 ≈ 2.5k tokens。当总量达到 85% 时 Layer 3 会统一处理（摘要整个对话）。这不是触发断层，是合理的成本权衡。

### 7.4 "Budget Strategy 1 仅初始检查" — 非死代码，职责不同

Budget check 的 Strategy 1（`keepRecentTurns=1`）和每步的 `compactBeforeStep`（`keepRecentTurns=3`）服务不同场景：

| 场景 | 策略 | keepRecentTurns | 原因 |
|------|------|----------------|------|
| 加载历史对话 | Budget Strategy 1 | 1（激进） | 历史工具输出价值低，一次性清理 |
| 活跃对话中 | compactBeforeStep Layer 2 | 3（保守） | 保留最近上下文提高回复质量 |

不同激进度在不同阶段使用，是有意设计。

### 7.5 "Reactive Retry 被动触发" — 非死代码，是安全网

`retry.ts` 使用更激进的 `targetPercent=0.50`（压缩到 50%），作为最后防线：

```
正常路径: Layer 2 (每步) → Layer 3 (85% 触发) → 目标 60%
失败路径: API 返回 context_length_exceeded → Reactive Retry → 目标 50%
```

被动触发是设计意图——它捕获主动压缩遗漏的边缘情况。修复 Bug #1-3 后，Reactive Retry 应该极少被触发，但作为防御层保留是正确的。

### 7.6 综合结论

| 提出的问题 | 分类 | 根因 | 处置 |
|-----------|------|------|------|
| 20%-85% 死区 | Bug #2 的症状 | 触发条件只看 messagesTokens | 修复 Bug #2 即解决 |
| 纯文本无压缩 | Bug #2 的症状 | Layer 3 无法触发 | 修复 Bug #2 即解决 |
| 小输出不压缩 | 设计决策 | 压缩收益低于元数据开销 | 无需修改 |
| Budget Strategy 1 "死代码" | 误判 | 服务不同场景（初始加载 vs 活跃对话） | 无需修改 |
| Reactive Retry "死代码" | 误判 | 安全网设计 | 无需修改 |

**必须修复的 Bug：** #1（contextLimit 未透传）、#2（触发条件只看 messagesTokens）、#3（Strategy 3 未转发 contextLimit）、#4（enforceContextWindow 零值开销 + target 偏高）。

**核心判断：不需要增加新的压缩层或调整 Layer 2 职责。** 修复文档第 4 节描述的 4 个 bug 后，现有三层架构能够正确覆盖所有场景。用户提出的"方案1（50% 中间层）"和"方案3（定期强制压缩）"会引入不必要的复杂度和过早压缩，降低对话质量。

## 8. 测试计划

修复涉及核心压缩逻辑，需要单元测试覆盖每个 Bug 的触发/不触发边界。

### 8.1 Bug #1: estimateFullRequest + checkInitialBudget 使用 contextLimitOverride

```typescript
// 验证 estimateFullRequest 使用 override
test('estimateFullRequest uses contextLimitOverride when provided', async () => {
  const est = await estimateFullRequest(msgs, instructions, tools, modelName, 22800);
  expect(est.modelLimit).toBe(22800);
  expect(est.utilizationPercent).toBeGreaterThan(50); // 而非基于 128k 的 ~15%
});

// 验证 budget check 各 Strategy 阈值正确
test('checkInitialBudget triggers Strategy 2 when tools exceed 10% of user limit', async () => {
  const result = await checkInitialBudget(msgs, instructions, largeTools, modelName, config, {
    ...context,
    contextLimit: 22800,  // 10% = 2280, largeTools > 2280
  });
  expect(result.adjustedTools).toBeDefined(); // 应该触发工具过滤
});
```

### 8.2 Bug #2: compactBeforeStep 总量触发

```typescript
// 消息少但总量（含开销）达到 85% 时应触发
test('compactBeforeStep triggers when total estimation >= 85% of limit', async () => {
  const result = await compactBeforeStep(messages, toolOutputState, config, {
    ...context,
    contextLimit: 22800,
    instructionsTokens: 1000,
    toolsTokens: 9200,
    // messagesTokens ~1.1k + 1000 + 9200 + 8000 = 19.3k → 84.6% ≈ 触发边界
  });
  // 验证 Layer 3 被触发
});

// 消息少且总量低于 85% 时不应触发
test('compactBeforeStep does not trigger when total < 85%', async () => {
  // 使用更大的 contextLimit 使总量低于 85%
});
```

### 8.3 Bug #3: budget-check Strategy 3 转发 contextLimit

```typescript
test('Strategy 3 passes contextLimit to enforceContextWindow', async () => {
  // 模拟需要 Strategy 3 的场景
  // 验证 enforceContextWindow 收到的 contextLimit 是用户配置值
});
```

### 8.4 Bug #4: enforceContextWindow guard + target 使用真实开销

```typescript
// Guard 使用总量判断
test('enforceContextWindow triggers based on total tokens including real overhead', async () => {
  const result = await enforceContextWindow(messages, {
    ...context,
    instructionsTokens: 1000,
    toolsTokens: 9200,
    contextLimit: 22800,
  });
  expect(result.executed).toBe(true);
});

// Target 使用真实开销
test('enforceContextWindow target accounts for real instructions and tools', async () => {
  // 验证压缩后消息量符合 targetMessageTokens = max(MIN, target - real overhead)
});

// 最小消息预算保护
test('enforceContextWindow enforces minimum message budget', async () => {
  // 使用极小 contextLimit 使 rawBudget < MIN_MESSAGE_BUDGET_TOKENS
  // 验证 targetMessageTokens = MIN_MESSAGE_BUDGET_TOKENS 而非 0
});
```

### 8.5 回归测试

```typescript
// 无 contextLimit override 时行为不变（向后兼容）
test('estimateFullRequest without override defaults to 128k', async () => {
  const est = await estimateFullRequest(msgs, instructions, tools, modelName);
  expect(est.modelLimit).toBe(128_000);
});

// Reactive retry 仍然作为安全网工作
test('reactive retry uses targetPercent 0.50 on context_length_exceeded', async () => {
  // 验证 retry 路径不受修复影响
});
```
