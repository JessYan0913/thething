# 上下文压缩机制对比分析：thething vs 某项目

> 分析时间：2026-07-23
> 目的：从 某项目 借鉴优秀设计，改进 thething 的上下文压缩机制

## 架构对比

### thething (当前实现)

```
Layer 2: 工具输出生命周期
  ↓
Layer 2.5: 确定性文本压缩
  ↓
Layer 3: 紧急 LLM 摘要
  ↓
Fallback: 强制截断
```

**调用时机**：
- `compactBeforeStep`：每步 API 调用前
- `checkInitialBudget`：Agent 创建时
- `handleReactiveRetry`：API 失败后重试

**特点**：
- ❌ **Layer 1 已删除**（原因：2026-07-21 事故后简化）
- ✅ 四层保证机制
- ✅ 后台 Checkpoint（运行结束后异步）
- ⚠️ 工具输出压缩后的**视图机制缺失**，每步重新计算

### 某项目 (参考实现)

```
Strategy 0: 应用持久化摘要（跨轮闭环）
  ↓
Layer 1: 定向压缩（compact_tool_result 工具触发）
  ↓
Layer 2: 工具输出生命周期
  ↓
Layer 3: LLM 摘要
  ↓
Strategy 4: 紧急截断
```

**调用时机**：
- `compactBeforeStep`：每步 API 调用前（with view）
- `checkInitialBudget`：历史恢复时（5 层策略）
- `reactive-compact-retry`：API 失败重试

**特点**：
- ✅ **Layer 1 保留**（`compact_tool_result` 工具，用户/LLM 主动触发）
- ✅ **CompactionView 视图机制**（跨步骤零成本前缀替换）
- ✅ **增量 token 估算**（只重估变更部分）
- ✅ **Usage 校准器**（动态调整 tokenizer buffer）
- ✅ **详细的遥测日志**（compaction-telemetry）

## 关键差异与借鉴点

### 1. ⭐ CompactionView 视图机制（最重要）

**某项目 的设计**：

```typescript
// compaction-view.ts
interface CompactionView {
  summary: {
    message: UIMessage;           // 稳定 ID 的摘要消息
    anchorIndex: number;          // 被覆盖区间的最后一条消息下标
    anchorFingerprint: string;    // 锚点消息内容指纹
    summaryText: string;          // 摘要正文
  } | null;
}
```

**工作原理**：
1. Layer 3 生成摘要后，记录：
   - 摘要消息（稳定 ID，如 `summary-<conversationId>-<anchorIndex>`）
   - 锚点位置（摘要覆盖到第几条消息）
   - 锚点指纹（验证历史是否被修改）

2. 下一步 `compactBeforeStep` 时：
   - **O(1) 验证**：检查 `messages[anchorIndex]` 的指纹
   - **如果匹配**：直接用摘要消息替换 `messages[0..anchorIndex]`
   - **零 LLM 调用、前缀逐字节稳定** → KV cache 友好

3. 失效条件：
   - 指纹不匹配（历史被外部修改）
   - 数组过短（历史被截断）
   - 自动清空视图，回退正常压缩路径

**thething 的问题**：
- 每步都重新执行 Layer 2/3，即使上一步已经压缩过
- Layer 3 生成的摘要消息 ID 是动态的 `CHECKPOINT_SUMMARY_ID_PREFIX + uuid()`
- 每步调用 LLM 重新生成摘要 → **成本高、cache miss**

**借鉴建议**：
```typescript
// 在 thething 中实现类似机制
interface CompactionView {
  summary: {
    message: import('ai').ModelMessage;
    anchorIndex: number;
    anchorFingerprint: string;  // 使用 fingerprintMessage 计算
  } | null;
}

// sessionState 中添加
sessionState.compactionView = createCompactionView();

// compactBeforeStep 开头
if (sessionState.compactionView?.summary) {
  const viewResult = applyCompactionView(messages, sessionState.compactionView);
  if (viewResult.applied) {
    messages = viewResult.messages;
    // 跳过重复的 L3 调用
  }
}
```

**优先级**：🔥🔥🔥 **HIGH** - 直接影响性能和成本

---

### 2. ⭐ Strategy 0: 持久化摘要跨轮应用

**某项目 的设计**：

```typescript
// initial-budget-check.ts:174-197
// Strategy 0: 应用上一轮持久化的 L3 摘要（跨轮闭环，零 LLM 成本）
const s0 = await applyStoredSummaryToHistory(currentMessages, conversationId, dataStore);
if (s0) {
  currentMessages = s0.messages;
  appliedStoredSummary = {
    anchorIndex: s0.anchorIndex,
    message: s0.summaryMessage,
    summaryText: s0.summaryText,
  };
  // 初始化 compactionView，使 in-loop 视图机制无缝衔接
}
```

**工作原理**：
1. 上一轮会话结束时，L3 已经生成摘要并存入 DataStore
2. 下一轮加载历史时，**优先应用已存摘要**
3. 同时初始化 `compactionView`，使后续步骤无缝复用

**thething 的实现**：
- 有 `applyCheckpointOnLoad` 机制（checkpoint.ts）
- ✅ 已经实现了基本的持久化摘要加载
- ⚠️ 但没有初始化视图机制，导致后续步骤仍需重新压缩

**借鉴建议**：
```typescript
// 在 createAgent 中
const checkpointResult = await applyCheckpointOnLoad(messagesWithAttachments, conversationId, dataStore);
if (checkpointResult.applied) {
  messagesWithAttachments = checkpointResult.messages;
  
  // 🆕 初始化视图
  sessionState.compactionView = {
    summary: {
      message: checkpointResult.summaryMessage,
      anchorIndex: checkpointResult.anchorIndex,
      anchorFingerprint: fingerprintMessage(messages[checkpointResult.anchorIndex]),
    }
  };
}
```

**优先级**：🔥🔥 **MEDIUM-HIGH** - 与视图机制配合使用

---

### 3. ⭐ Layer 1: 定向压缩工具

**某项目 的设计**：

```typescript
// 提供 compact_tool_result 工具给 LLM
{
  name: 'compact_tool_result',
  description: 'Compress a specific tool output by its toolCallId to save context',
  parameters: z.object({
    toolCallId: z.string(),
  }),
}

// Layer 1: 按 toolCallId 定向压缩
export async function applyPendingCompactions(
  messages: UIMessage[],
  toolCallIds: string[],  // 从工具调用中收集
  config: LifecycleConfig,
  modelName?: string,
): Promise<CompactionResult>
```

**工作原理**：
1. LLM 可以主动调用 `compact_tool_result(toolCallId)` 
2. 系统收集 `pendingCompactIds`
3. 下一步 `compactBeforeStep` 时，**只压缩指定的工具输出**
4. 精确 token 计数（压缩前后对比）

**thething 的状态**：
- ❌ Layer 1 已删除（2026-07-21 事故后）
- ℹ️ 删除原因：八层机制过于复杂，导致维护困难

**是否需要恢复？**

**反对恢复的理由**：
- 增加系统复杂度
- LLM 不太会主动使用这个工具
- Layer 2 的自动老化已经够用

**支持恢复的理由**：
- 给 LLM 更多控制权（"这个 5MB 的文件内容现在用不到了，压缩掉"）
- 对于长期运行的 Agent，可以减少不必要的上下文
- 某项目 的实现相对简单（~50 行核心逻辑）

**折中方案**：
- **暂不恢复**，先实现 CompactionView 视图机制
- 如果发现 Layer 2 自动老化不够精准，再考虑添加

**优先级**：🔥 **LOW** - 非必需，系统提示词可引导 LLM 使用 Layer 2

---

### 4. ⭐ 增量 Token 估算

**某项目 的设计**：

```typescript
// initial-budget-check.ts:86-120
async function reestimatePartial(
  prevEstimation: FullRequestEstimation,
  changedPart: 'messages' | 'tools' | 'messagesAndTools',
  newMessages?: UIMessage[],
  newTools?: Record<string, Tool>,
  modelName?: string,
): Promise<FullRequestEstimation> {
  // 只重估变更的部分，复用 instructions 和 outputReserve
  const [messagesTokens, toolsTokens] = await Promise.all([
    changedPart.includes('messages')
      ? estimateMessagesTokens(newMessages!, modelName)
      : prevEstimation.messagesTokens,
    changedPart.includes('tools')
      ? estimateToolsTokens(newTools!, modelName)
      : prevEstimation.toolsTokens,
  ]);
  // ...
}
```

**工作原理**：
1. 首次估算后保存 `prevEstimation`
2. 每次策略应用后，只重估变更的部分
3. `instructions` 和 `outputReserve` 不变，直接复用

**thething 的实现**：
```typescript
// budget-check.ts
// ❌ 每次都全量重估
currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName, contextLimit);
```

**优化收益**：
- 减少重复的 token 计算
- 尤其是 instructions 可能很长（10k+ tokens）

**借鉴建议**：
```typescript
// 在 budget-check.ts 中
async function reestimateAfterStrategy(
  prevEstimation: FullRequestEstimation,
  changedPart: 'messages' | 'tools' | 'both',
  newMessages?: ModelMessage[],
  newTools?: Record<string, Tool>,
  modelName: string,
  contextLimit?: number,
): Promise<FullRequestEstimation> {
  // 只重估变更部分
  if (changedPart === 'messages') {
    const messagesTokens = await estimateMessagesTokens(newMessages!, modelName);
    const totalTokens = messagesTokens + prevEstimation.instructionsTokens + prevEstimation.toolsTokens + prevEstimation.outputReserve;
    // ...
  }
  // ...
}

// 使用
currentEstimation = await reestimateAfterStrategy(currentEstimation, 'messages', currentMessages, undefined, modelName, contextLimit);
```

**优先级**：🔥🔥 **MEDIUM** - 性能优化，非关键

---

### 5. Usage 校准器（UsageCalibrator）

**某项目 的设计**：

```typescript
// usage-calibrator.ts
export class UsageCalibrator {
  track(estimated: number, actual: number): void {
    // 记录估算值 vs 实际值
  }
  
  getDriftRatio(): number {
    // 返回 actual / estimated 的移动平均
    // estimated × driftRatio ≈ actual
  }
}

// 使用动态 buffer
const bufferRatio = driftRatio != null 
  ? driftRatio - 1  // 可能为负（估算偏高时收回预留）
  : getTokenizerBufferRatio(modelName);  // 静态值 fallback
```

**工作原理**：
1. 每次 API 调用后，记录：
   - 估算的 token 数（基于 tiktoken）
   - 实际的 token 数（从 API response 获取）
2. 计算漂移比率：`driftRatio = actual / estimated`
3. 动态调整 tokenizer buffer

**thething 的实现**：
- ❌ 没有 usage 校准机制
- 使用固定的 buffer ratio（10-15%）

**是否需要？**

**好处**：
- 更精确的预算控制
- 避免过度保守（浪费上下文）或过度激进（超限）

**成本**：
- 需要持久化存储（DataStore）
- 增加系统复杂度

**建议**：
- **暂不实现**，优先级较低
- 固定 buffer 已经够用
- 如果发现频繁超限或预算浪费，再考虑

**优先级**：🔥 **LOW** - 优化项，非必需

---

### 6. ⭐ Token 缓存机制

**某项目 的设计**：

```typescript
// compactBeforeStep 接受 tokenCache 参数
export interface CompactBeforeStepInput {
  tokenCache?: Map<string, number>;  // key 为 message.id
  // ...
}

// Layer 1/2 修改消息后，精准失效缓存
if (tokenCache && layer1Result.affectedMessageIds) {
  for (const id of layer1Result.affectedMessageIds) {
    tokenCache.delete(id);
  }
}
```

**工作原理**：
1. 每条消息的 token 数缓存在 `Map<messageId, tokenCount>`
2. 只有被修改的消息才失效缓存
3. 下次估算时复用未变更消息的缓存值

**thething 的实现**：
- ❌ 没有消息级 token 缓存
- 每次估算都重新计算所有消息

**是否需要？**

**好处**：
- 大幅减少重复的 token 计算
- 尤其是历史消息未变更时

**实现复杂度**：
- 中等（需要确保消息有稳定的 ID）
- 需要在 sessionState 中维护 cache

**建议**：
- **值得实现**，性能收益明显
- 与增量估算配合使用效果更好

**优先级**：🔥🔥 **MEDIUM** - 性能优化

---

### 7. 遥测与日志

**某项目 的设计**：

```typescript
// compaction-telemetry.ts
export function emitCompactionTelemetry(event: CompactionTelemetryEvent): void {
  // 结构化日志 + 可选的外部遥测服务
}

// logger.ts
export function clog(component: string, action: string, data?: Record<string, unknown>): void {
  // 彩色、结构化的日志输出
}

// 可视化当前状态
logContextStatus({
  step: stepNumber,
  msgs: currentTokens,
  instr: instructionsTokens,
  tools: toolsTokens,
  limit: contextLimit,
  trigger: triggerThreshold,
  outputReserve: outputReserve,
  tokenizerBuffer: tokenizerBufferTokens,
});
```

**输出示例**：
```
[compact] L1 定向压缩 { freed: 12450, ids: 3 }
[compact] L2 工具生命周期 { freed: 45200 }
[budget] after-L2 { tokens: 95000 }
```

**thething 的实现**：
- 使用 `logger.debug/info/warn`
- 日志相对简单

**借鉴建议**：
- 添加更结构化的日志
- 特别是在 budget check 和 compaction 流程中
- 方便调试和监控

**优先级**：🔥 **LOW-MEDIUM** - 开发体验提升

---

## 优先级总结

### 🔥🔥🔥 HIGH - 立即实现

1. **CompactionView 视图机制**
   - **收益**：零 LLM 成本、KV cache 友好、大幅降低压缩开销
   - **实现难度**：中等（~200 行）
   - **影响范围**：`compactBeforeStep`, `sessionState`, `checkpoint`

2. **Strategy 0 与视图初始化**
   - **收益**：跨轮闭环，历史摘要无缝复用
   - **实现难度**：低（修改 createAgent 即可）
   - **依赖**：视图机制

### 🔥🔥 MEDIUM - 近期实现

3. **增量 Token 估算**
   - **收益**：减少重复计算，特别是 instructions 部分
   - **实现难度**：低（~50 行）
   - **影响范围**：`budget-check.ts`

4. **Token 缓存机制**
   - **收益**：减少重复 token 计算
   - **实现难度**：中等（需要消息 ID 管理）
   - **影响范围**：`sessionState`, `token-counter`, `compactBeforeStep`

### 🔥 LOW - 可选

5. **Layer 1 恢复**（定向压缩工具）
   - **收益**：给 LLM 更多控制权
   - **成本**：增加复杂度
   - **建议**：暂不恢复，观察 Layer 2 效果

6. **Usage 校准器**
   - **收益**：动态调整 tokenizer buffer
   - **成本**：增加复杂度
   - **建议**：暂不实现，固定 buffer 够用

7. **遥测与日志优化**
   - **收益**：开发体验提升
   - **成本**：低
   - **建议**：逐步改进

---

## 实施计划

### Phase 1: 视图机制（本周）

1. 创建 `compaction-view.ts`：
   - `CompactionView` 接口
   - `fingerprintMessage` 函数
   - `applyCompactionView` 函数
   - `updateViewAfterL3` 函数

2. 修改 `sessionState`：
   - 添加 `compactionView?: CompactionView`

3. 修改 `compactBeforeStep`：
   - 开头添加视图应用逻辑
   - Layer 3 成功后更新视图

4. 修改 `checkpoint.ts`：
   - `applyCheckpointOnLoad` 返回锚点信息
   - 在 `createAgent` 中初始化视图

5. 测试：
   - 多步对话，验证视图复用
   - 历史修改时视图失效
   - KV cache 命中率提升

### Phase 2: 增量估算（下周）

1. 创建 `reestimateAfterStrategy` 函数
2. 修改 `budget-check.ts` 使用增量估算
3. 性能测试

### Phase 3: Token 缓存（下下周）

1. 确保消息有稳定 ID
2. 在 `sessionState` 中添加 `tokenCache: Map<string, number>`
3. 修改 `estimateMessagesTokens` 支持缓存
4. 修改压缩函数清空受影响消息的缓存

---

## 其他观察

### 代码组织

**某项目**：
- 文件更细分（19 个文件）
- 每个文件职责单一
- 测试覆盖率高

**thething**：
- 文件较少（~10 个文件）
- 部分文件较大（index.ts 200 行）

**建议**：保持当前组织，文件数量合理

### 命名风格

**某项目**：
- 使用 `clog`, `cwarn`, `cerr`（简洁）
- Strategy 0/1/2/3（数字编号）

**thething**：
- 使用 `logger.debug/info/warn`（标准）
- Layer 1/2/2.5/3（分层编号）

**建议**：保持当前风格，更清晰

---

## 总结

某项目 的核心优势在于：

1. **CompactionView 视图机制** - 跨步骤零成本前缀替换
2. **Strategy 0** - 跨轮摘要复用
3. **增量估算** - 减少重复计算
4. **详细遥测** - 便于调试和监控

thething 应该优先实现 #1 和 #2，这将带来最大的性能和成本收益。其他特性可以逐步添加，或根据实际需求决定是否需要。
