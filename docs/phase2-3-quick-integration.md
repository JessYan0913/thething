# Phase 2 & 3 快速集成指南

> **当前状态**: compaction-view.ts ✅ 已完成
> **剩余工作**: 4 个文件需要修改

## ✅ 已完成

1. **compaction-view.ts** - 遥测集成完成
   - Import `CompactionTelemetry`
   - `CompactionView` 接口添加 `telemetry?` 字段
   - `createCompactionView` 接受 `telemetry` 参数  
   - `applyCompactionView` 添加遥测记录

---

## 📝 手动完成步骤（按优先级）

### Step 1: session/state.ts ⭐ 最重要

**文件**: `packages/core/src/modules/session/state.ts`

#### 1.1 添加 Import（文件顶部，约第 24 行）

```typescript
import { CompactionTelemetry } from '../compaction/compaction-telemetry';
```

#### 1.2 修改 SessionState 接口（约第 40 行）

找到：
```typescript
export interface SessionState {
  // ... 其他字段
  compactionView: CompactionView;
}
```

修改为：
```typescript
export interface SessionState {
  // ... 其他字段
  compactionView: CompactionView;
  telemetry: CompactionTelemetry;  // 🆕 添加这行
}
```

#### 1.3 创建 telemetry 实例（约第 90 行，`createSessionState` 函数中）

找到：
```typescript
compactionView: createCompactionView(),
```

修改为：
```typescript
telemetry: new CompactionTelemetry(),  // 🆕 先创建
compactionView: createCompactionView(new CompactionTelemetry()),  // 🆕 传入实例
```

**注意**：需要创建两个实例，一个给 state，一个给 view。或者只创建一个共享：
```typescript
const telemetry = new CompactionTelemetry();
return {
  // ... 其他字段
  telemetry,
  compactionView: createCompactionView(telemetry),
};
```

#### 1.4 在 compact 方法中传递 telemetry（约第 150 行）

找到：
```typescript
return compactBeforeStep(messages, this.compactionConfig, {
  storage: this.dataStore,
  model: this.model,
  // ... 其他参数
  compactionView: this.compactionView,
});
```

添加：
```typescript
return compactBeforeStep(messages, this.compactionConfig, {
  storage: this.dataStore,
  model: this.model,
  // ... 其他参数
  compactionView: this.compactionView,
  telemetry: this.telemetry,  // 🆕 添加这行
});
```

---

### Step 2: compaction/index.ts

**文件**: `packages/core/src/modules/compaction/index.ts`

#### 2.1 添加 Import（约第 24 行后）

```typescript
import type { CompactionTelemetry } from './compaction-telemetry';
```

#### 2.2 添加 telemetry 参数（约第 55 行，`compactBeforeStep` 函数）

找到：
```typescript
  context: {
    // ... 其他字段
    compactionView?: CompactionView;
  },
```

修改为：
```typescript
  context: {
    // ... 其他字段
    compactionView?: CompactionView;
    telemetry?: CompactionTelemetry;  // 🆕 添加这行
  },
```

#### 2.3 在 Layer 3 成功后记录遥测（约第 200 行）

找到：
```typescript
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

  // 继续估算...
}
```

在 `logger.debug` 之后添加：
```typescript
  logger.debug('Compaction', `View updated: anchorIndex=${summaryResult.anchorIndex}`);

  // 🆕 记录 Layer 3 遥测
  const reason = !context.compactionView?.summary ? 'no_view' : 'budget_exceeded';
  context.telemetry?.recordLayer3Triggered({
    reason,
    messagesBeforeCompaction: messages.length,
    messagesAfterCompaction: current.length,
    durationMs: 0, // TODO: 可以添加计时
  });
```

---

### Step 3: checkpoint.ts（可选，用于 checkpoint 加载遥测）

**文件**: `packages/core/src/modules/compaction/checkpoint.ts`

#### 3.1 添加 telemetry 参数

找到：
```typescript
export function applyCheckpointOnLoad(
  messages: UIMessage[],
  conversationId: string,
  store: GlobalStore,
): CheckpointLoadResult {
```

修改为：
```typescript
export function applyCheckpointOnLoad(
  messages: UIMessage[],
  conversationId: string,
  store: GlobalStore,
  telemetry?: import('./compaction-telemetry').CompactionTelemetry,  // 🆕 添加这行
): CheckpointLoadResult {
```

#### 3.2 在返回前记录遥测

找到两个 return 语句，分别添加遥测：

**成功加载**：
```typescript
// 在 return { applied: true, ... } 之前
telemetry?.recordCheckpointLoaded({
  applied: true,
  anchorIndex: index,
  messagesSkipped: index,
});

return { applied: true, ... };
```

**未加载**：
```typescript
// 在 return { applied: false, ... } 之前
telemetry?.recordCheckpointLoaded({
  applied: false,
});

return { applied: false, ... };
```

---

### Step 4: API route 传递 telemetry（可选）

**文件**: `packages/app/app/api/chat/route.ts`

找到：
```typescript
const checkpointResult = applyCheckpointOnLoad(existingMessages, conversationId, store);
```

修改为：
```typescript
const checkpointResult = applyCheckpointOnLoad(
  existingMessages,
  conversationId,
  store,
  sessionState.telemetry,  // 🆕 传递 telemetry
);
```

---

## 🧪 验证步骤

### 验证 1: 编译检查

```bash
cd packages/core
pnpm typecheck
```

**期望**：无类型错误

### 验证 2: 运行应用

```bash
pnpm dev
```

**期望**：应用正常启动

### 验证 3: 查看遥测报告

在浏览器控制台（或 API 中添加日志）：

```typescript
// 获取遥测统计
const stats = sessionState.telemetry.getStats();
console.log(stats);

// 获取遥测报告
const report = sessionState.telemetry.generateReport();
console.log(report);
```

**期望输出**：
```
{
  viewAppliedCount: 3,
  viewInvalidatedCount: 0,
  layer3TriggeredCount: 1,
  viewHitRate: 0.75,
  estimatedTotalTimeSavedMs: 15000,
  ...
}
```

---

## 📊 完成检查清单

- [ ] Step 1.1: session/state.ts import
- [ ] Step 1.2: SessionState 接口添加 telemetry
- [ ] Step 1.3: 创建 telemetry 实例
- [ ] Step 1.4: compact 方法传递 telemetry
- [ ] Step 2.1: compaction/index.ts import
- [ ] Step 2.2: compactBeforeStep 参数添加 telemetry
- [ ] Step 2.3: Layer 3 遥测记录
- [ ] Step 3.1: checkpoint.ts 参数（可选）
- [ ] Step 3.2: checkpoint 遥测记录（可选）
- [ ] Step 4: API route 传递 telemetry（可选）
- [ ] 编译验证
- [ ] 运行验证
- [ ] 遥测报告验证

---

## 💡 快速完成方案

如果你想快速完成，可以：

1. **最小集成**（5-10 分钟）：
   - 只完成 Step 1 和 Step 2
   - 跳过 Step 3 和 Step 4
   - 这样就能看到 Layer 3 和视图应用的遥测

2. **完整集成**（15-20 分钟）：
   - 完成所有 4 个步骤
   - 包含 checkpoint 加载遥测

---

## 🚀 开始吧！

**建议顺序**：
1. Step 1（session/state.ts）- 最重要
2. Step 2（compaction/index.ts）- 核心遥测
3. 编译验证
4. 运行测试
5. （可选）Step 3 和 Step 4

**需要帮助？**告诉我你在哪一步遇到问题！
