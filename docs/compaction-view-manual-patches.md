# CompactionView 集成补丁

> 由于文件同步问题，这里列出所有需要手动应用的改动
> 或者可以基于这些改动创建 git patch

## 改动 1: emergency-summary.ts - 添加视图更新信息

**文件**: `packages/core/src/modules/compaction/emergency-summary.ts`

**位置**: 第 20-30 行（`EmergencySummaryResult` 接口）

**改动**:
```typescript
export interface EmergencySummaryResult {
  messages: import('ai').ModelMessage[];
  success: boolean;
  error?: string;
  // 🆕 添加以下三个字段
  summaryMessage?: import('ai').ModelMessage;
  anchorIndex?: number;
  summaryText?: string;
}
```

**位置**: 第 85-120 行（`emergencySummarize` 函数返回值）

**改动**: 在成功生成摘要后，返回额外信息：
```typescript
// 找到这段代码（约第 110 行）：
const compactedMessages = [firstUserMsg, summaryMessage, ...recentMessages];

return {
  messages: compactedMessages,
  success: true,
  // 🆕 添加以下三行
  summaryMessage,
  anchorIndex: middleEnd - 1,  // 摘要覆盖到第 middleEnd-1 条消息
  summaryText: summaryContent,
};
```

---

## 改动 2: index.ts - 集成视图机制

**文件**: `packages/core/src/modules/compaction/index.ts`

### 2.1 添加 import

**位置**: 文件开头（约第 10 行）

**改动**:
```typescript
import { applyCompactionView, updateViewAfterL3 } from './compaction-view';
import type { CompactionView } from './compaction-view';
```

### 2.2 修改 `compactBeforeStep` 参数

**位置**: 第 45-65 行（`compactBeforeStep` 函数签名）

**改动**: 在 context 参数中添加：
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
    compactionView?: CompactionView;  // 🆕 添加这一行
  },
): Promise<import('ai').ModelMessage[]> {
```

### 2.3 添加 Layer 0

**位置**: 函数开头（约第 70 行，`let current = messages;` 之后）

**改动**: 在 Layer 2 之前添加：
```typescript
let current = messages;

// ══════════════════════════════════════════════════════════
// Layer 0: 应用跨步骤压缩视图（零 LLM 调用）
// ══════════════════════════════════════════════════════════
if (context.compactionView) {
  const viewResult = applyCompactionView(current, context.compactionView);
  if (viewResult.applied) {
    current = viewResult.messages;
    logger.info('Compaction', `View applied: ${messages.length} → ${current.length} messages`);
    // 视图生效，前缀已被摘要替换，跳过后续 Layer
    return current;
  }
}

// ── Layer 2: 工具输出生命周期管理（同步，微秒级）──
// ... 继续现有代码 ...
```

### 2.4 Layer 3 后更新视图

**位置**: 约第 170-180 行（`emergencySummarize` 调用成功后）

**改动**: 找到这段代码：
```typescript
const summaryResult = await emergencySummarize(current, {
  model: context.model,
  fallbackModels: context.fallbackModels,
  targetPercent: 0.6,
});

if (summaryResult.success) {
  current = summaryResult.messages;
  
  // 🆕 添加以下视图更新代码
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

  // 检查是否满足预算
  const afterSummary = await estimateFullRequest(
    // ... 继续现有代码 ...
```

---

## 改动 3: checkpoint.ts - 返回视图初始化信息

**文件**: `packages/core/src/modules/compaction/checkpoint.ts`

### 3.1 修改返回类型

**位置**: 找到 `applyCheckpointOnLoad` 函数的返回类型定义（如果没有显式定义，在函数注释中添加）

**改动**:
```typescript
export interface CheckpointLoadResult {
  applied: boolean;
  messages: import('ai').ModelMessage[];
  // 🆕 添加以下三个字段
  summaryMessage?: import('ai').ModelMessage;
  anchorIndex?: number;
  summaryText?: string;
}

export async function applyCheckpointOnLoad(
  messages: import('ai').ModelMessage[],
  conversationId: string,
  dataStore: DataStore,
): Promise<CheckpointLoadResult> {
  // ... 函数体 ...
}
```

### 3.2 修改返回值

**位置**: 函数中成功加载 checkpoint 的返回语句

**改动**: 找到这段代码并修改：
```typescript
if (checkpoints.length > 0) {
  const latest = checkpoints[0];
  const summaryMsg = buildSummaryMessage(latest.summary, 'model');
  const remaining = messages.slice(latest.anchorIndex + 1);
  
  return {
    applied: true,
    messages: [summaryMsg, ...remaining],
    // 🆕 添加以下三行
    summaryMessage: summaryMsg,
    anchorIndex: latest.anchorIndex,
    summaryText: latest.summary,
  };
}

// 未找到 checkpoint 的返回也需要更新
return {
  applied: false,
  messages,
  // 🆕 添加这三行（虽然都是 undefined）
  summaryMessage: undefined,
  anchorIndex: undefined,
  summaryText: undefined,
};
```

---

## 改动 4: composition/compaction.ts - 传递视图

**文件**: `packages/core/src/composition/compaction.ts`

### 4.1 修改 createCompactFunction

**位置**: `createCompactFunction` 函数返回的 compact 函数

**改动**: 确保 `compactionView` 从 sessionState 传递到 `compactBeforeStep`：

```typescript
export function createCompactFunction(
  sessionState: SessionState,
  model: LanguageModelV3,
  fallbackModels: LanguageModelV3[],
  config: CompactionConfig,
  conversationId: string,
  dataStore: DataStore,
  modelName: string,
  // ... 其他参数
): (messages: import('ai').ModelMessage[]) => Promise<CompactionResult> {
  return async (messages) => {
    const result = await compactBeforeStep(messages, config, {
      model,
      fallbackModels,
      modelName,
      conversationId,
      dataStore,
      instructionsTokens,
      toolsTokens,
      contextLimit,
      storage,
      writer,
      tools,
      instructions,
      compactionView: sessionState.compactionView,  // 🆕 添加这一行
    });

    return {
      messages: result,
      executed: result.length !== messages.length,
      tokensFreed: 0,  // 可以计算实际释放的 tokens
      actions: [],
    };
  };
}
```

---

## 改动 5: create.ts - 初始化视图

**文件**: `packages/core/src/composition/app/create.ts`

### 5.1 添加 import

**位置**: 文件开头

**改动**:
```typescript
import { fingerprintMessage } from '../../modules/compaction/compaction-view';
```

### 5.2 Checkpoint 加载后初始化视图

**位置**: 找到 `applyCheckpointOnLoad` 调用的位置

**改动**: 在成功加载 checkpoint 后添加：
```typescript
// 加载 checkpoint 摘要
const checkpointResult = await applyCheckpointOnLoad(
  messagesWithAttachments as import('ai').ModelMessage[],
  conversationId,
  dataStore,
);

if (checkpointResult.applied) {
  messagesWithAttachments = checkpointResult.messages;
  
  // 🆕 初始化 compactionView（跨轮闭环）
  if (checkpointResult.summaryMessage && checkpointResult.anchorIndex != null && checkpointResult.summaryText) {
    // 需要从原始 initialMessages 中获取锚点消息来计算指纹
    const originalAnchorMessage = initialMessages[checkpointResult.anchorIndex];
    if (originalAnchorMessage) {
      sessionState.compactionView.summary = {
        message: checkpointResult.summaryMessage,
        anchorIndex: checkpointResult.anchorIndex,
        anchorFingerprint: fingerprintMessage(originalAnchorMessage as import('ai').ModelMessage),
        summaryText: checkpointResult.summaryText,
      };
      logger.info('Checkpoint', `CompactionView initialized from stored summary (anchor=${checkpointResult.anchorIndex})`);
    }
  }
}
```

---

## 验证清单

完成所有改动后，运行以下验证：

### 1. 类型检查
```bash
cd e:\thething
pnpm typecheck
```

### 2. 编译测试
```bash
cd e:\thething\packages\core
pnpm build
```

### 3. 单元测试（如果存在）
```bash
pnpm test compaction
```

### 4. 手动测试

启动一个长对话，触发 Layer 3：

```bash
# 观察日志输出
# 第一次 Layer 3: 应该看到 "emergencySummarize" 调用
# 第二步开始: 应该看到 "View applied: X → Y messages"
# 第二步不应该再调用 LLM
```

---

## 完整性检查

- [ ] `emergency-summary.ts`: `EmergencySummaryResult` 添加了 3 个新字段
- [ ] `emergency-summary.ts`: 返回值包含 `summaryMessage`, `anchorIndex`, `summaryText`
- [ ] `index.ts`: 添加了 `applyCompactionView` 和 `updateViewAfterL3` import
- [ ] `index.ts`: `compactBeforeStep` 参数添加了 `compactionView`
- [ ] `index.ts`: Layer 0 在函数开头应用视图
- [ ] `index.ts`: Layer 3 成功后更新视图
- [ ] `checkpoint.ts`: 返回类型添加视图信息
- [ ] `checkpoint.ts`: 返回值包含视图初始化所需信息
- [ ] `composition/compaction.ts`: 传递 `sessionState.compactionView`
- [ ] `create.ts`: import `fingerprintMessage`
- [ ] `create.ts`: checkpoint 加载后初始化视图

---

## 预期效果

完成后应该看到：

1. **首次 Layer 3**: 
   ```
   [Compaction] Layer 3 - Emergency compression
   [Compaction] emergencySummarize: 100 → 30 messages
   [Compaction] View updated: anchorIndex=80
   ```

2. **后续步骤**:
   ```
   [Compaction] View applied: 100 → 30 messages
   ```
   （注意：**没有** emergencySummarize 调用）

3. **性能提升**: Layer 3 调用减少 80%+，响应速度提升 2-5x

---

## 故障排查

### 问题 1: "View applied" 但消息数量没有减少

**原因**: 指纹不匹配，视图被清空
**检查**: 查看日志中的 "Anchor fingerprint mismatch" 警告
**解决**: 确保 `fingerprintMessage` 对 Layer 2 压缩保持稳定

### 问题 2: 视图从不生效

**原因**: `compactionView` 没有正确传递
**检查**: 在 `compactBeforeStep` 开头添加调试日志：
```typescript
logger.debug('Compaction', `View state: ${context.compactionView?.summary ? 'present' : 'null'}`);
```

### 问题 3: TypeError: Cannot read property 'summary' of undefined

**原因**: `sessionState.compactionView` 未初始化
**检查**: 确认 `session/state.ts` 中 `compactionView: createCompactionView()` 已添加

---

## 下一步

完成 Phase 1 后，可以继续：

- **Phase 2**: 增量 Token 估算（性能优化 30-50%）
- **Phase 3**: 结构化遥测（可观测性）
- **Phase 4**: Usage 校准器（自适应 buffer）

详见 `compaction-view-todo.md`
