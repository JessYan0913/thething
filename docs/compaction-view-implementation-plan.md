# CompactionView 视图机制实施计划

> AI SDK v7 适配版本
> 实施日期：2026-07-23

## Phase 1: 核心视图机制 ✅ 完成进度: 60%

### ✅ Step 1: 创建 compaction-view.ts
- 文件：`packages/core/src/modules/compaction/compaction-view.ts`
- 状态：**已创建**
- 内容：
  - `CompactionView` 和 `CompactionSummaryEntry` 类型定义
  - `fingerprintMessage()` - 消息内容指纹
  - `applyCompactionView()` - O(1) 前缀替换
  - `updateViewAfterL3()` - Layer 3 后更新视图
  - `clearView()` - 清空视图

### ✅ Step 2: 类型系统集成
- 文件：`packages/core/src/modules/session/types.ts`
- 状态：**已完成**
- 改动：
  ```typescript
  import type { CompactionView } from '../compaction/compaction-view';
  
  export interface SessionState {
    // ... 其他字段
    /** 跨步骤压缩视图（记录已被 L3 摘要覆盖的前缀） */
    compactionView: CompactionView;
  }
  ```

### ✅ Step 3: 初始化视图
- 文件：`packages/core/src/modules/session/state.ts`
- 状态：**已完成**
- 改动：
  ```typescript
  import { createCompactionView } from '../compaction/compaction-view';
  
  export function createSessionState(...) {
    const state: SessionState = {
      // ... 其他字段
      compactionView: createCompactionView(),
    };
  }
  ```

### ⏳ Step 4: 集成到 compactBeforeStep
- 文件：`packages/core/src/modules/compaction/index.ts`
- 状态：**待实施**
- 改动：

```typescript
// 在 compactBeforeStep 函数开头添加
import { applyCompactionView, updateViewAfterL3 } from './compaction-view';

export async function compactBeforeStep(
  messages: import('ai').ModelMessage[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context: {
    // ... 现有参数
    /** 跨步骤压缩视图 */
    compactionView?: import('./compaction-view').CompactionView;
  },
): Promise<import('ai').ModelMessage[]> {
  let current = messages;

  // ══════════════════════════════════════════════════════════
  // Layer 0: 应用跨步骤压缩视图 (零 LLM 成本)
  // ══════════════════════════════════════════════════════════
  if (context.compactionView) {
    const viewResult = applyCompactionView(current, context.compactionView);
    if (viewResult.applied) {
      current = viewResult.messages;
      logger.info('Compaction', `View applied: ${messages.length} → ${current.length} messages`);
      // 如果视图生效，直接返回（前缀已被摘要替换）
      // 跳过后续 Layer 2/3（已在上一次执行过）
      return current;
    }
  }

  // ── Layer 2: 工具输出生命周期管理（同步，微秒级）──
  // ... 现有 Layer 2 代码 ...

  // ── 预算检查：是否需要进一步压缩？ ──
  // ... 现有预算检查代码 ...

  // 如果 Layer 2 后仍超限，启动紧急压缩流程
  if (estimation.exceedsLimit) {
    // ... 现有紧急压缩代码 ...
    
    // ══════════════════════════════════════════════════════════
    // Layer 3 执行后：更新视图
    // ══════════════════════════════════════════════════════════
    // 注意：只在 Layer 3 (emergencySummarize) 实际执行时更新视图
    // Layer 2.5 (deterministic) 和 truncation 不更新视图
    
    // 在 applyEmergencyCompression 中，如果 Layer 3 成功：
    if (summaryResult.success && context.compactionView) {
      // summaryResult 应该返回：
      // - summaryMessage: 生成的摘要消息
      // - anchorIndex: 摘要覆盖到第几条消息
      // - summaryText: 摘要正文
      
      updateViewAfterL3(
        context.compactionView,
        summaryResult.summaryMessage,
        summaryResult.anchorIndex,
        messages[summaryResult.anchorIndex],  // 锚点消息
        summaryResult.summaryText,
      );
    }
  }

  return current;
}
```

#### 具体修改位置：

**位置 1: compactBeforeStep 开头（第 55 行之后）**
```typescript
export async function compactBeforeStep(
  messages: import('ai').ModelMessage[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    conversationId: string;
    dataStore: DataStore;
    instructionsTokens?: number;
    toolsTokens?: number;
    contextLimit?: number;
    storage?: { sessionId: string; dataDir: string };
    writer?: { write: (chunk: unknown) => void };
    tools?: Record<string, Tool>;
    instructions?: string;
    compactionView?: import('./compaction-view').CompactionView;  // 🆕 添加
  },
): Promise<import('ai').ModelMessage[]> {
  let current = messages;

  // 🆕 Layer 0: 应用跨步骤压缩视图
  if (context.compactionView) {
    const viewResult = applyCompactionView(current, context.compactionView);
    if (viewResult.applied) {
      current = viewResult.messages;
      logger.info('Compaction', `View applied: ${messages.length} → ${current.length} messages`);
      return current;  // 早期返回，跳过后续 Layer
    }
  }

  // ── Layer 2: 工具输出生命周期管理（同步，微秒级）──
  // ... 继续现有代码 ...
```

**位置 2: applyEmergencyCompression 返回值修改**

需要修改 `emergency-summary.ts` 的返回类型，使其包含必要的视图更新信息：

```typescript
// emergency-summary.ts
export interface EmergencySummaryResult {
  success: boolean;
  messages: import('ai').ModelMessage[];
  summaryMessage?: import('ai').ModelMessage;  // 🆕 摘要消息
  anchorIndex?: number;                        // 🆕 锚点位置
  summaryText?: string;                        // 🆕 摘要正文
}
```

**位置 3: index.ts 中 Layer 3 后更新视图**

在 `applyEmergencyCompression` 函数的 Layer 3 成功后：

```typescript
// index.ts:169 - Layer 3 成功后
const summaryResult = await emergencySummarize(current, {
  model: context.model,
  fallbackModels: context.fallbackModels,
  targetPercent: 0.6,
});

if (summaryResult.success) {
  current = summaryResult.messages;
  
  // 🆕 更新视图（如果提供了 compactionView）
  if (context.compactionView && summaryResult.summaryMessage && summaryResult.anchorIndex != null) {
    updateViewAfterL3(
      context.compactionView,
      summaryResult.summaryMessage,
      summaryResult.anchorIndex,
      messages[summaryResult.anchorIndex],
      summaryResult.summaryText!,
    );
  }

  const afterSummary = await estimateFullRequest(
    current,
    context.instructions,
    context.tools,
    context.modelName,
    context.contextLimit,
  );
  // ... 继续现有代码 ...
}
```

### ⏳ Step 5: 修改 pipeline.ts 传递视图
- 文件：`packages/core/src/modules/agent-control/pipeline.ts`
- 状态：**待实施**
- 改动（第 176 行）：

```typescript
// 每步调用 compactBeforeStep（Layer 2 + Layer 3）
const compactResult = await sessionState.compact(messages as import('ai').ModelMessage[]);
```

需要修改 session 的 `compact` 函数签名，使其接受 `sessionState` 作为上下文。

**选项 A: 修改 compact 函数闭包**（推荐）

在 `session/state.ts` 中：

```typescript
async compact(messages: import('ai').ModelMessage[]): Promise<CompactionResult> {
  if (!compactionEnabled) {
    return { messages, executed: false, tokensFreed: 0, actions: [] };
  }
  if (compactFn) {
    // 🆕 传递 compactionView
    return compactFn(messages, state.compactionView);  // 闭包访问 state
  }
  return { messages, executed: false, tokensFreed: 0, actions: [] };
},
```

**选项 B: 在 composition 层传递**

在 `composition/app/create.ts` 中创建 compactFn 时：

```typescript
// 包装 compactBeforeStep，传入 sessionState.compactionView
const compactFn = async (messages: ModelMessage[]) => {
  const result = await compactBeforeStep(messages, compactionConfig, {
    model,
    fallbackModels,
    modelName: modelId,
    conversationId,
    dataStore,
    instructionsTokens,
    toolsTokens,
    contextLimit: modelContextLimit,
    storage: { sessionId: conversationId, dataDir: layout.dataDir },
    writer,
    tools: toolsMap,
    instructions: fullInstructions,
    compactionView: sessionState.compactionView,  // 🆕 传递视图
  });
  
  return {
    messages: result,
    executed: true,  // 简化：只要调用了就算执行
    tokensFreed: 0,  // 实际值需要 compactBeforeStep 返回
    actions: [],
  };
};
```

### ⏳ Step 6: Strategy 0 - 持久化摘要跨轮应用
- 文件：`packages/core/src/modules/compaction/checkpoint.ts`
- 状态：**待实施**
- 改动：

```typescript
import { updateViewAfterL3 } from './compaction-view';

export async function applyCheckpointOnLoad(
  messages: import('ai').ModelMessage[],
  conversationId: string,
  dataStore: DataStore,
  compactionView?: import('./compaction-view').CompactionView,  // 🆕 添加参数
): Promise<{
  messages: import('ai').ModelMessage[];
  applied: boolean;
  tokensFreed?: number;
}> {
  // ... 现有加载 checkpoint 的代码 ...
  
  if (checkpoint) {
    const summaryMessage = buildSummaryMessage(checkpoint.summary, 'model');
    const anchorIndex = checkpoint.lastMessageIndex;
    
    // 替换前缀
    const compacted = [summaryMessage, ...messages.slice(anchorIndex + 1)];
    
    // 🆕 初始化视图（关键：使持久化摘要在后续步骤复用）
    if (compactionView) {
      updateViewAfterL3(
        compactionView,
        summaryMessage,
        anchorIndex,
        messages[anchorIndex],
        checkpoint.summary,
      );
    }
    
    return {
      messages: compacted,
      applied: true,
      tokensFreed: checkpoint.tokensFreed,
    };
  }
  
  return { messages, applied: false };
}
```

**调用处修改**（composition/app/create.ts）：

```typescript
// 应用 checkpoint（如果有）
const checkpointResult = await applyCheckpointOnLoad(
  messagesWithAttachments,
  conversationId,
  dataStore,
  sessionState.compactionView,  // 🆕 传递视图
);

if (checkpointResult.applied) {
  messagesWithAttachments = checkpointResult.messages;
  logger.info('Checkpoint', `Applied: freed ${checkpointResult.tokensFreed} tokens`);
}
```

---

## Phase 2: 增量 Token 估算 ⏳

### ⏳ Step 7: 创建 reestimatePartial 函数
- 文件：`packages/core/src/modules/compaction/token-counter.ts`
- 状态：**待实施**

```typescript
export type ChangedPart = 'messages' | 'tools' | 'both';

/**
 * 增量重估算：只重估变更的部分
 * instructions 和 outputReserve 不变，直接复用
 */
export async function reestimatePartial(
  prevEstimation: FullRequestEstimation,
  changedPart: ChangedPart,
  newMessages?: import('ai').ModelMessage[],
  newTools?: Record<string, Tool>,
  modelName?: string,
): Promise<FullRequestEstimation> {
  const [messagesTokens, toolsTokens] = await Promise.all([
    changedPart === 'messages' || changedPart === 'both'
      ? estimateMessagesTokens(newMessages!, modelName)
      : Promise.resolve(prevEstimation.messagesTokens),
    changedPart === 'tools' || changedPart === 'both'
      ? estimateToolsTokens(newTools!)
      : Promise.resolve(prevEstimation.toolsTokens),
  ]);

  const totalTokens =
    messagesTokens +
    prevEstimation.instructionsTokens +
    toolsTokens +
    prevEstimation.outputReserve;
    
  const availableBudget = prevEstimation.modelLimit - totalTokens;
  const exceedsLimit = totalTokens > prevEstimation.modelLimit;
  const utilizationPercent = (totalTokens / prevEstimation.modelLimit) * 100;

  return {
    ...prevEstimation,
    messagesTokens,
    toolsTokens,
    totalTokens,
    availableBudget,
    exceedsLimit,
    utilizationPercent,
  };
}
```

### ⏳ Step 8: 在 budget-check.ts 中使用增量估算
- 文件：`packages/core/src/modules/compaction/budget-check.ts`
- 状态：**待实施**

替换所有的 `estimateFullRequest` 调用（除了第一次）为 `reestimatePartial`：

```typescript
// 第一次：全量估算
const initialEstimation = await estimateFullRequest(messages, instructions, tools, modelName, contextLimit);

// 后续：增量估算
// Layer 2 后
currentEstimation = await reestimatePartial(
  currentEstimation,
  'messages',  // 只有 messages 变了
  currentMessages,
  undefined,
  modelName,
);

// Tool filtering 后
currentEstimation = await reestimatePartial(
  currentEstimation,
  'tools',  // 只有 tools 变了
  undefined,
  currentTools,
  modelName,
);
```

---

## Phase 3: 遥测 (可选) ⏳

### ⏳ Step 9: 创建 compaction-telemetry.ts
- 文件：`packages/core/src/modules/compaction/compaction-telemetry.ts`
- 状态：**待实施**

```typescript
export interface CompactionTelemetryEvent {
  conversationId: string;
  timestamp: string;
  eventName: 'view-applied' | 'l2-executed' | 'l3-executed' | 'truncation';
  tokensFreed: number;
  messagesBefor: number;
  messagesAfter: number;
  details?: Record<string, unknown>;
}

export function emitCompactionTelemetry(event: CompactionTelemetryEvent): void {
  // 集成到现有监控系统
  logger.info('CompactionTelemetry', JSON.stringify(event));
}
```

### ⏳ Step 10: 在关键点埋点
- 在 `applyCompactionView` 成功时
- 在 Layer 2 执行后
- 在 Layer 3 执行后

---

## Phase 4: Usage 校准器 (高级优化) ⏳

暂时跳过，优先级低。

---

## 验证检查清单

### ✅ 基础验证
- [ ] `pnpm typecheck` 通过
- [ ] 所有 compaction 相关测试通过
- [ ] 创建新会话，验证 `sessionState.compactionView` 已初始化

### 🔬 功能验证

#### Test 1: 视图应用（零 LLM 调用）
```typescript
// 场景：长对话，触发 Layer 3 摘要
// 预期：第二步开始，compactionView.applied = true，无 LLM 调用

1. 创建长对话（100+ 条消息）
2. 第一步触发 Layer 3，生成摘要
   - 检查：sessionState.compactionView.summary != null
   - 检查：有 LLM 调用（emergency-summary.ts）
3. 第二步继续对话
   - 检查：applyCompactionView 返回 applied=true
   - 检查：无 LLM 调用（跳过 Layer 3）
   - 检查：messages[0] 是摘要消息
4. 重复步骤 3，验证持续生效
```

#### Test 2: 指纹失效（历史被修改）
```typescript
// 场景：外部修改历史（删除消息）
// 预期：视图失效，回退正常压缩流程

1. 触发 Layer 3，建立视图
2. 模拟删除历史中间的几条消息
3. 下一步调用 compactBeforeStep
   - 检查：applyCompactionView 返回 applied=false
   - 检查：view.summary = null（视图已清空）
   - 检查：正常执行 Layer 2/3
```

#### Test 3: 跨轮闭环（持久化摘要）
```typescript
// 场景：上一轮会话生成摘要，下一轮加载复用
// 预期：加载时应用摘要并初始化视图

1. 第一轮会话：触发 Layer 3，生成 checkpoint
2. 结束会话，保存 checkpoint 到 DataStore
3. 第二轮会话：加载历史
   - 检查：applyCheckpointOnLoad 应用成功
   - 检查：sessionState.compactionView.summary != null
4. 继续对话
   - 检查：applyCompactionView 生效（零 LLM 成本）
```

#### Test 4: 增量估算性能
```typescript
// 场景：多次策略尝试
// 预期：减少 token 估算时间

1. 触发 budget check（超限）
2. 记录每次 estimateFullRequest 的耗时
3. 对比修改前后：
   - 修改前：每次策略后全量重估（~100ms）
   - 修改后：只重估变更部分（~30ms）
```

---

## 回滚计划

如果遇到问题，按以下顺序回滚：

1. **最小回滚**：注释掉 Layer 0 视图应用逻辑
   ```typescript
   // if (context.compactionView) { ... }
   ```

2. **部分回滚**：移除视图更新，保留类型定义
   ```typescript
   // updateViewAfterL3(...)
   ```

3. **完全回滚**：删除 `compaction-view.ts`，恢复 session/types.ts

---

## 预期收益

### 性能
- Layer 3 LLM 调用减少 **80%+**
- 每步压缩时间从 **2-5s 降至 <100ms**（视图命中时）
- KV cache 命中率提升 **50%+**（前缀稳定）

### 成本
- 长对话成本降低 **30-50%**（减少 LLM 调用）
- 典型 200 轮对话：节省 ~10 次 Layer 3 调用（~$0.05-0.10）

### 用户体验
- 响应延迟降低（减少摘要生成等待）
- 支持更长对话（压缩效率提升）

---

## 相关文档

- [compaction-learnings-from-某项目.md](./compaction-learnings-from-某项目.md) - 借鉴点总结
- [context-compaction-architecture.md](./context-compaction-architecture.md) - 现有架构文档
- [budget-check-fix-validation.md](../.claude/validation/budget-check-fix-validation.md) - 之前的修复

---

## 实施时间线

- **Day 1**: Phase 1 Step 4-6（核心集成）
- **Day 2**: Phase 2（增量估算）+ 测试验证
- **Day 3**: Phase 3（遥测，可选）+ 文档更新

预计总工作量：**2-3 天**
