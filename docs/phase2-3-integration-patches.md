# Phase 2 & 3 集成补丁

本文档包含所有需要手动应用的代码改动。由于文件系统同步问题，请手动复制粘贴这些改动。

## ✅ 已完成

### 1. compaction-view.ts
- ✅ Import `CompactionTelemetry`（第 26 行）
- ✅ `CompactionView` 接口添加 `telemetry?` 字段（第 52 行）
- ✅ `createCompactionView` 接受 `telemetry` 参数（第 58 行）
- ✅ `applyCompactionView` 添加遥测记录（第 154-204 行）

## 🔧 待应用的改动

### 2. compaction/index.ts

**Import 添加**（第 25 行后）:
```typescript
import type { CompactionTelemetry } from './compaction-telemetry';
```

**修改 `compactBeforeStep` 参数**（约第 40 行）:
```typescript
export async function compactBeforeStep(
  messages: import('ai').ModelMessage[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context: {
    // ... 其他参数
    compactionView?: CompactionView;
    telemetry?: CompactionTelemetry;  // 🆕 添加这行
  },
): Promise<import('ai').ModelMessage[]> {
```

**在 Layer 2 执行后添加遥测**（约第 90 行，`manageToolOutputLifecycle` 之后）:
```typescript
// Layer 2: 工具输出生命周期管理（同步，微秒级）
const lifecycle = manageToolOutputLifecycle(current, config.lifecycle, context.storage);
current = lifecycle.messages;

// 🆕 记录 Layer 2 遥测
if (lifecycle.hasChanges) {
  context.telemetry?.recordLayer2Executed({
    toolResultsCompressed: lifecycle.changedCount || 0,
    bytesFreed: 0, // 可以计算
    durationMs: 0, // 可以计算
  });
}

// 落盘异步进行...
```

**在 Layer 3 触发后添加遥测**（约第 180 行，`emergencySummarize` 之后）:
```typescript
const layer3Start = performance.now();  // 🆕 添加计时

const summaryResult = await emergencySummarize(current, {
  model: context.model,
  fallbackModels: context.fallbackModels,
  targetPercent: 0.6,
});

const layer3Duration = performance.now() - layer3Start;  // 🆕 计算耗时

if (summaryResult.success) {
  current = summaryResult.messages;

  // 更新视图（如果提供了 compactionView）
  if (context.compactionView && summaryResult.summaryMessage && summaryResult.anchorIndex != null) {
    updateViewAfterL3(
      context.compactionView,
      summaryResult.summaryMessage,
      summaryResult.anchorIndex,
      messages[summaryResult.anchorIndex],
      summaryResult.summaryText!,
    );
    logger.debug('Compaction', `View updated: anchorIndex=${summaryResult.anchorIndex}`);
  }

  // 🆕 记录 Layer 3 遥测
  const reason = !context.compactionView?.summary ? 'no_view' : 'budget_exceeded';
  context.telemetry?.recordLayer3Triggered({
    reason,
    messagesBeforeCompaction: messages.length,
    messagesAfterCompaction: current.length,
    tokensFreed: undefined, // 可选
    durationMs: layer3Duration,
  });

  // ... 继续后面的代码
}
```

### 3. session/state.ts

**Import 添加**（约第 24 行）:
```typescript
import { CompactionTelemetry } from '../compaction/compaction-telemetry';
```

**在 createSessionState 中创建遥测实例**（约第 90 行）:
```typescript
export function createSessionState(...) {
  // ... 其他初始化

  // 🆕 创建遥测收集器
  const telemetry = new CompactionTelemetry();

  return {
    // ... 其他字段
    compactionView: createCompactionView(telemetry),  // 🆕 传入 telemetry
    telemetry,  // 🆕 存储到 state
    
    // ... 其他字段
  };
}
```

**SessionState 类型添加 telemetry 字段**（约第 40 行）:
```typescript
export interface SessionState {
  // ... 其他字段
  telemetry: CompactionTelemetry;  // 🆕
}
```

**添加获取遥测报告的方法**（文件末尾）:
```typescript
/**
 * 获取遥测报告
 */
export function getTelemetryReport(state: SessionState): string {
  return state.telemetry.generateReport();
}

/**
 * 获取遥测统计
 */
export function getTelemetryStats(state: SessionState) {
  return state.telemetry.getStats();
}
```

### 4. checkpoint.ts

**在 `applyCheckpointOnLoad` 中添加遥测**（约第 80 行，返回之前）:
```typescript
export function applyCheckpointOnLoad(
  messages: UIMessage[],
  conversationId: string,
  store: GlobalStore,
  telemetry?: CompactionTelemetry,  // 🆕 添加参数
): CheckpointLoadResult {
  // ... 现有代码

  if (checkpoint && checkpoint.anchorMessageId) {
    // ... 应用 checkpoint

    // 🆕 记录遥测
    telemetry?.recordCheckpointLoaded({
      applied: true,
      anchorIndex: index,
      messagesSkipped: index,
    });

    return {
      applied: true,
      messages: [summaryMessage, ...newerMessages],
      summaryMessage,
      anchorIndex: index,
      summaryText: checkpoint.summary,
    };
  }

  // 🆕 记录未应用
  telemetry?.recordCheckpointLoaded({
    applied: false,
  });

  return {
    applied: false,
    messages,
  };
}
```

### 5. 传递 telemetry 到各个函数

**在 API route 中传递**（`packages/app/app/api/chat/route.ts`）:
```typescript
// 获取 telemetry（从 sessionState）
const telemetry = sessionState.telemetry;

// 传递给 applyCheckpointOnLoad
const checkpointResult = applyCheckpointOnLoad(
  existingMessages,
  conversationId,
  store,
  telemetry,  // 🆕
);

// 传递给 compactBeforeStep（在 session 的 compact 方法中）
```

**在 session/state.ts 的 compact 方法中传递**:
```typescript
async compact(messages: ModelMessage[]): Promise<ModelMessage[]> {
  return compactBeforeStep(messages, this.compactionConfig, {
    storage: this.dataStore,
    model: this.model,
    fallbackModels: this.fallbackModels,
    modelName: this.modelName,
    contextLimit: this.maxContextTokens,
    targetTokens: this.targetTokens,
    tools: this.tools,
    instructions: this.instructions,
    compactionView: this.compactionView,
    telemetry: this.telemetry,  // 🆕 添加这行
  });
}
```

---

## 📊 Phase 2: 增量 Token 估算（后续集成）

### 6. session/state.ts - 添加估算缓存

**SessionState 类型添加字段**:
```typescript
export interface SessionState {
  // ... 其他字段
  lastEstimation?: import('../compaction/incremental-estimation').CachedEstimation;  // 🆕
}
```

**初始化**:
```typescript
export function createSessionState(...) {
  return {
    // ... 其他字段
    lastEstimation: undefined,  // 🆕
  };
}
```

### 7. 使用增量估算（在 estimateFullRequest 调用处）

**Import**:
```typescript
import { estimateTokensIncremental } from '../compaction/incremental-estimation';
```

**替换 estimateFullRequest**:
```typescript
// 之前：
const estimation = await estimateFullRequest(
  messages,
  instructions,
  tools,
  modelName,
  contextLimit,
);

// 现在：
const estimation = await estimateTokensIncremental(
  messages,
  instructions,
  tools,
  modelName,
  {
    previousEstimation: context.lastEstimation,  // 🆕 传入之前的估算
  },
);

// 保存估算结果
context.lastEstimation = estimation;  // 🆕
```

---

## 🧪 测试验证

### Phase 3 遥测测试

在应用重启后，在浏览器控制台运行：

```javascript
// 获取遥测报告（需要暴露 API）
fetch('/api/telemetry')
  .then(r => r.text())
  .then(console.log);
```

或者在服务端日志中查看（需要添加定期打印）：

```typescript
// 每 5 分钟打印一次遥测报告
setInterval(() => {
  const report = getTelemetryReport(sessionState);
  console.log('\n' + report);
}, 5 * 60 * 1000);
```

### 预期输出

```
=== Compaction Telemetry Report ===
Time Range: 2024-01-20 10:00:00 - 10:15:30 (15.5 min)

View Performance:
  Applied: 12 times
  Invalidated: 1 times
  Hit Rate: 92.31%
  Avg Messages Compressed: 38.5 per application
  Total Time Saved: ~60000ms (60.0s)

Layer 3 (LLM Summary):
  Triggered: 1 times
  Avg Duration: 5200ms
  Avg Compression: 45 → 3 messages

Layer 2 (Deterministic):
  Executed: 13 times
  Total Bytes Freed: 125430

Checkpoint:
  Loaded: 1 times
```

---

## 🎯 集成顺序

建议按以下顺序手动应用改动：

1. ✅ **compaction-view.ts**（已完成）
2. **compaction/index.ts** - 添加 Import 和 telemetry 参数
3. **session/types.ts** - 添加 telemetry 字段
4. **session/state.ts** - 创建遥测实例，传递给视图
5. **session/state.ts** - 在 compact 方法中传递 telemetry
6. **checkpoint.ts** - 添加遥测记录
7. **compaction/index.ts** - 添加 Layer 2/3 遥测记录
8. **测试** - 启动应用，验证遥测工作

完成 Phase 3 后再进行 Phase 2 增量估算。

---

## 💡 提示

由于文件系统同步问题，建议：
1. 在 IDE 中打开每个文件
2. 手动复制粘贴代码
3. 保存并验证
4. 一次只改一个文件，避免冲突

或者等待文件同步完成后使用自动化脚本。
