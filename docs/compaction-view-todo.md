# CompactionView 实施待办清单

## ✅ 已完成（Phase 1 - 60%）

1. ✅ 创建 `compaction-view.ts` 核心模块
2. ✅ 在 `session/types.ts` 添加 `CompactionView` 类型
3. ✅ 在 `session/state.ts` 初始化 `compactionView`
4. ✅ 更新文档注释为 AI SDK v7

## 🔄 进行中（Phase 1 - 剩余 40%）

### Step 4: 集成到 compaction/index.ts

**文件**: `packages/core/src/modules/compaction/index.ts`

**改动 4.1**: 添加 import
```typescript
import { applyCompactionView, updateViewAfterL3 } from './compaction-view';
```

**改动 4.2**: `compactBeforeStep` 参数添加 `compactionView`
```typescript
context: {
  // ... 现有参数
  compactionView?: import('./compaction-view').CompactionView;  // 🆕
}
```

**改动 4.3**: 函数开头添加 Layer 0（第 60 行之后）
```typescript
let current = messages;

// 🆕 Layer 0: 应用跨步骤压缩视图（零成本）
if (context.compactionView) {
  const viewResult = applyCompactionView(current, context.compactionView);
  if (viewResult.applied) {
    current = viewResult.messages;
    logger.info('Compaction', `View applied: ${messages.length} → ${current.length}`);
    return current;  // 早期返回
  }
}

// ── Layer 2: 工具输出生命周期管理 ──
// ... 继续现有代码 ...
```

**改动 4.4**: Layer 3 成功后更新视图（约第 180-190 行）

需要先修改 `emergency-summary.ts` 返回类型：
```typescript
export interface EmergencySummaryResult {
  success: boolean;
  messages: import('ai').ModelMessage[];
  summaryMessage?: import('ai').ModelMessage;  // 🆕
  anchorIndex?: number;                        // 🆕
  summaryText?: string;                        // 🆕
}
```

然后在 `index.ts` 的 Layer 3 成功后添加：
```typescript
if (summaryResult.success) {
  current = summaryResult.messages;
  
  // 🆕 更新视图
  if (context.compactionView && summaryResult.summaryMessage != null && summaryResult.anchorIndex != null) {
    updateViewAfterL3(
      context.compactionView,
      summaryResult.summaryMessage,
      summaryResult.anchorIndex,
      messages[summaryResult.anchorIndex],
      summaryResult.summaryText!,
    );
  }
  
  // ... 继续现有代码 ...
}
```

---

### Step 5: 修改 session/state.ts compact 函数

**文件**: `packages/core/src/modules/session/state.ts`

**改动 5.1**: compact 函数传递 `compactionView`
```typescript
async compact(messages: import('ai').ModelMessage[]): Promise<CompactionResult> {
  if (!compactionEnabled) {
    return { messages, executed: false, tokensFreed: 0, actions: [] };
  }
  if (compactFn) {
    // 🔧 确保 compactFn 能访问 state.compactionView
    // 选项 A: 修改 compactFn 接受第二个参数
    // 选项 B: 在 composition/compaction.ts 中访问 sessionState
    return compactFn(messages, state.compactionView);  // 🆕 传递视图
  }
  return { messages, executed: false, tokensFreed: 0, actions: [] };
},
```

---

### Step 6: 修改 composition/compaction.ts

**文件**: `packages/core/src/composition/compaction.ts`

**改动 6.1**: compact 函数签名
```typescript
export async function compact(
  messages: import('ai').ModelMessage[],
  compactionView: CompactionView,  // 🆕
  // ... 其他参数
): Promise<CompactionResult> {
  // ...
  const result = await compactBeforeStep(messages, config, {
    // ... 现有参数
    compactionView,  // 🆕 传递
  });
  // ...
}
```

---

### Step 7: Strategy 0 - checkpoint 加载时初始化视图

**文件**: `packages/core/src/modules/compaction/checkpoint.ts`

**改动 7.1**: `applyCheckpointOnLoad` 返回值添加视图信息
```typescript
export interface CheckpointLoadResult {
  applied: boolean;
  messages: import('ai').ModelMessage[];
  summaryMessage?: import('ai').ModelMessage;  // 🆕
  anchorIndex?: number;                        // 🆕
  summaryText?: string;                        // 🆕
}
```

**改动 7.2**: 函数内返回额外信息
```typescript
if (checkpoints.length > 0) {
  const latest = checkpoints[0];
  const summaryMsg = buildSummaryMessage(latest.summary, 'model');
  const remaining = messages.slice(latest.anchorIndex + 1);
  
  return {
    applied: true,
    messages: [summaryMsg, ...remaining],
    summaryMessage: summaryMsg,        // 🆕
    anchorIndex: latest.anchorIndex,  // 🆕
    summaryText: latest.summary,      // 🆕
  };
}
```

---

### Step 8: 在 create.ts 中初始化视图

**文件**: `packages/core/src/composition/app/create.ts`

**改动 8.1**: checkpoint 加载后初始化视图
```typescript
// 加载 checkpoint 摘要
const checkpointResult = await applyCheckpointOnLoad(
  messagesWithAttachments as import('ai').ModelMessage[],
  conversationId,
  dataStore,
);

if (checkpointResult.applied) {
  messagesWithAttachments = checkpointResult.messages;
  
  // 🆕 初始化 compactionView
  if (checkpointResult.summaryMessage && checkpointResult.anchorIndex != null) {
    sessionState.compactionView.summary = {
      message: checkpointResult.summaryMessage,
      anchorIndex: checkpointResult.anchorIndex,
      anchorFingerprint: fingerprintMessage(
        initialMessages[checkpointResult.anchorIndex] as import('ai').ModelMessage
      ),
      summaryText: checkpointResult.summaryText!,
    };
  }
}
```

需要添加 import：
```typescript
import { fingerprintMessage } from '../modules/compaction/compaction-view';
```

---

## 📋 Phase 2: 增量 Token 估算（后续）

1. ⏳ 创建 `reestimatePartial` 函数
2. ⏳ 修改 `budget-check.ts` 使用增量估算
3. ⏳ 测试验证

## 📋 Phase 3: 遥测（可选）

1. ⏳ 创建 `compaction-telemetry.ts`
2. ⏳ 在关键点埋点
3. ⏳ 集成到监控系统

## 📋 Phase 4: Usage 校准器（高级）

1. ⏳ 创建 `usage-calibrator.ts`
2. ⏳ 集成到 compactBeforeStep
3. ⏳ 测试不同模型

---

## 🧪 测试计划

### 测试 1: 视图基础功能
```bash
# 运行单元测试
pnpm --filter @thething/core test compaction-view
```

### 测试 2: 跨步骤视图复用
1. 启动长对话（触发 Layer 3）
2. 观察日志：第一次 Layer 3 应该调用 LLM
3. 第二步应该看到 "View applied" 日志
4. 第二步不应该有 Layer 3 LLM 调用

### 测试 3: 指纹失效
1. 手动修改历史消息
2. 视图应该失效，回退到正常压缩路径
3. 日志应该显示 "Anchor fingerprint mismatch"

---

## 📊 预期收益

- **性能提升**: 2-5x（取决于对话长度）
- **成本降低**: 80%+ Layer 3 LLM 调用
- **KV Cache**: 前缀逐字节稳定，命中率提升

---

## ⚠️ 注意事项

1. **稳定 ID**: 摘要消息必须使用稳定 ID（如 `summary-<conversationId>-<anchorIndex>`）
2. **指纹计算**: 必须对 Layer 2 压缩保持稳定（使用 toolCallId，不用 output）
3. **视图失效**: 历史被外部修改时自动清空视图，安全回退
4. **早期返回**: Layer 0 生效时必须返回，不执行后续 Layer（避免重复压缩）

---

## 🔗 相关文档

- [compaction-learnings-from-某项目.md](./compaction-learnings-from-某项目.md) - 借鉴分析
- [compaction-view-implementation-plan.md](./compaction-view-implementation-plan.md) - 详细实施计划
- [context-compaction-architecture.md](./context-compaction-architecture.md) - 架构文档
