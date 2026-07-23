# Phase 1 剩余任务 - 完成指南

> 截至目前进度：85% 完成
> 剩余：修改 compact 函数调用链，初始化视图

## ✅ 已完成

1. ✅ 创建 `compaction-view.ts` 核心模块
2. ✅ 类型系统集成（`session/types.ts`）
3. ✅ 视图初始化（`session/state.ts`）
4. ✅ 修改 `emergency-summary.ts` 返回视图信息
5. ✅ 修改 `index.ts` 添加 Layer 0 和视图更新
6. ✅ 修改 `checkpoint.ts` 返回类型和值

## 🔄 剩余任务

### Task 1: 修改 session/state.ts compact 函数

**文件**: `packages/core/src/modules/session/state.ts`

**问题**: `compact` 函数需要访问 `compactionView` 并传递给 `compactBeforeStep`

**当前代码**（第 116-124 行）:
```typescript
async compact(messages: import('ai').ModelMessage[]): Promise<CompactionResult> {
  if (!compactionEnabled) {
    return { messages, executed: false, tokensFreed: 0, actions: [] };
  }
  if (compactFn) {
    return compactFn(messages);
  }
  return { messages, executed: false, tokensFreed: 0, actions: [] };
},
```

**方案 A：修改 compactFn 调用（推荐）**

如果 `compactFn` 是从外部注入的，需要确保它能访问 `compactionView`。

**检查调用链**：
1. 搜索哪里调用 `createSessionState` 并传入 `compact` 参数
2. 修改那个地方，使 `compact` 函数能访问 session state

或者

**方案 B：内联实现（如果没有外部 compactFn）**

```typescript
import { compactBeforeStep } from '../compaction';

async compact(messages: import('ai').ModelMessage[]): Promise<CompactionResult> {
  if (!compactionEnabled) {
    return { messages, executed: false, tokensFreed: 0, actions: [] };
  }
  
  if (compactFn) {
    // 外部注入的压缩函数（需要确保它能访问 compactionView）
    return compactFn(messages);
  }
  
  // 默认实现：直接调用 compactBeforeStep
  if (!state.compactModel || !compactionCfg) {
    return { messages, executed: false, tokensFreed: 0, actions: [] };
  }
  
  const compactedMessages = await compactBeforeStep(messages, compactionCfg, {
    model: state.compactModel,
    fallbackModels: state.fallbackModels,
    modelName: state.model,
    conversationId,
    dataStore,
    instructionsTokens: undefined,  // 由 prepareStep 提供
    toolsTokens: undefined,
    contextLimit: maxContextTokens,
    compactionView: state.compactionView,  // 🔑 关键：传递视图
  });
  
  return {
    messages: compactedMessages,
    executed: compactedMessages.length !== messages.length,
    tokensFreed: 0,  // 可以计算
    actions: [],
  };
},
```

### Task 2: 找到并修改外部 compact 创建位置

**搜索命令**:
```bash
# 找到创建 SessionState 的位置
grep -rn "createSessionState" packages/core/src --include="*.ts" | grep -v test | grep -v "export function"

# 找到传入 compact 参数的位置
grep -rn "compact:" packages/core/src --include="*.ts" | grep -v test
```

**预期位置**: 可能在 `composition/app/create.ts` 或类似的组合层文件

**修改示例**:
```typescript
// 假设在某个创建 agent 的地方
const sessionState = createSessionState(conversationId, {
  ...options,
  compact: async (messages) => {
    // 🔧 这里需要访问 sessionState.compactionView
    // 方案 1: 使用闭包（如果 sessionState 已经创建）
    // 方案 2: 修改为不传入 compact，使用方案 B 的内联实现
    
    return await compactBeforeStep(messages, compactionConfig, {
      // ... 其他参数
      compactionView: sessionState.compactionView,  // ❌ 问题：sessionState 还未创建
    });
  },
});
```

**解决方案**: 不传入 `compact` 参数，使用方案 B 的内联实现

### Task 3: 初始化视图 - 从 checkpoint 加载时

**文件**: 需要找到加载历史消息的地方

**搜索**:
```bash
# 找到调用 applyCheckpointOnLoad 的地方（除了导出）
grep -rn "applyCheckpointOnLoad" packages/core/src --include="*.ts" | grep -v "export" | grep -v test
```

**预期**: 应该在 Agent 创建或历史消息加载时

**修改示例**:
```typescript
import { fingerprintMessage } from '../modules/compaction/compaction-view';

// 加载历史消息
let messages = await messageStore.getMessages(conversationId);

// 应用 checkpoint
const checkpointResult = applyCheckpointOnLoad(messages, conversationId, dataStore);
if (checkpointResult.applied) {
  messages = checkpointResult.messages;
  
  // 🆕 初始化 compactionView
  if (checkpointResult.summaryMessage && checkpointResult.anchorIndex != null) {
    sessionState.compactionView.summary = {
      message: checkpointResult.summaryMessage as import('ai').ModelMessage,
      anchorIndex: checkpointResult.anchorIndex,
      anchorFingerprint: fingerprintMessage(
        messages[checkpointResult.anchorIndex] as import('ai').ModelMessage
      ),
      summaryText: checkpointResult.summaryText!,
    };
    logger.debug('Checkpoint', `View initialized: anchorIndex=${checkpointResult.anchorIndex}`);
  }
}
```

## 📝 实施步骤

### 步骤 1: 采用方案 B（内联实现）

1. 修改 `session/state.ts` 的 `compact` 函数
2. 添加 import: `import { compactBeforeStep } from '../compaction';`
3. 实现默认压缩逻辑（当没有 `compactFn` 时）

### 步骤 2: 确保 compactModel 和 fallbackModels 被设置

在 `session/state.ts` 中，需要确保 `compactModel` 和 `fallbackModels` 有值。

**检查**: 搜索哪里设置这些字段
```bash
grep -rn "compactModel\s*=" packages/core/src --include="*.ts" | grep -v test
```

如果没有设置，需要在创建 SessionState 时设置：
```typescript
const state: SessionState = {
  // ...
  compactModel: model,  // 使用主模型或快速模型
  fallbackModels: fallbackModels,
  compactionView: createCompactionView(),
};
```

### 步骤 3: 找到历史加载位置并初始化视图

**提示**: 可能在这些地方：
- `packages/core/src/composition/app/create.ts`
- `packages/core/src/modules/agent/create.ts`
- 任何调用 `messageStore.getMessages` 的地方

**特征码搜索**:
```bash
grep -rn "getMessages\|getConversation" packages/core/src --include="*.ts" | grep -v test | grep -v "export"
```

## 🧪 测试验证

完成上述修改后，运行测试：

```bash
# 单元测试
pnpm --filter @thething/core test compaction-view

# 集成测试 - 手动
# 1. 启动长对话，触发 Layer 3
# 2. 观察日志：应该看到 "Layer 3: LLM summary"
# 3. 下一步应该看到 "View applied: X → Y messages"
# 4. 第二步不应该再有 "Layer 3: LLM summary"
```

## 🎯 完成标志

- [ ] `sessionState.compact` 能调用 `compactBeforeStep` 并传递 `compactionView`
- [ ] Checkpoint 加载时初始化 `compactionView.summary`
- [ ] 日志显示 "View applied" 在第二步之后
- [ ] Layer 3 LLM 调用减少 80%+

## 📞 需要帮助？

如果遇到问题：
1. 运行搜索命令，找到关键代码位置
2. 对照本文档的修改示例
3. 确保类型正确（`ModelMessage` vs `UIMessage`）

祝完成顺利！🎉
