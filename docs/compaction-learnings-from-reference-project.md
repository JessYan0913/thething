# 某项目 上下文压缩机制 - 关键借鉴点总结

> 基于 E:/某项目 代码分析
> 2026-07-23

## 核心优势 (vs thething)

### 1. 🔥🔥🔥 CompactionView 视图机制

**问题**：AI SDK v6 的 `prepareStep` 每步收到完整历史，压缩需要重做，Layer 3 重复调用 LLM

**某项目 解决方案**：
```typescript
// 记录"已被摘要覆盖的前缀"
interface CompactionView {
  summary: {
    message: UIMessage;          // 稳定 ID 的摘要消息
    anchorIndex: number;         // 覆盖到第几条消息
    anchorFingerprint: string;   // 锚点内容指纹（验证历史未被修改）
  } | null;
}

// 每步开头 O(1) 验证并替换
if (view && messages[anchorIndex]的指纹匹配) {
  messages = [view.summary.message, ...messages.slice(anchorIndex + 1)];
  // 零 LLM 调用、前缀逐字节稳定 → KV cache 友好
}
```

**收益**：
- ✅ 零 LLM 成本（跨步骤复用摘要）
- ✅ KV cache 命中率提升（前缀稳定）
- ✅ 性能提升（O(1) 前缀替换 vs 重新压缩）

**实现难度**：⭐⭐⭐ 中等
**优先级**：🔥🔥🔥 **最高**

---

### 2. 🔥🔥 Strategy 0: 持久化摘要跨轮应用

**问题**：上一轮 Checkpoint 生成的摘要没有在下一轮加载时应用

**某项目 解决方案**：
```typescript
// initial-budget-check.ts - Strategy 0（在所有策略之前）
const storedSummary = await dataStore.summaryStore.getSummaryByConversation(conversationId);
if (storedSummary) {
  // 用摘要替换 messages[0..anchorIndex]
  messages = [storedSummary.message, ...messages.slice(storedSummary.anchorIndex + 1)];
  
  // 🔑 同时初始化 compactionView，使后续步骤无缝复用
  sessionState.compactionView = {
    summary: {
      message: storedSummary.message,
      anchorIndex: storedSummary.anchorIndex,
      anchorFingerprint: fingerprintMessage(messages[storedSummary.anchorIndex]),
    }
  };
}
```

**收益**：
- ✅ 跨轮闭环（上一轮压缩成果在下一轮复用）
- ✅ 零 LLM 成本（直接加载持久化摘要）
- ✅ 与 CompactionView 配合，形成完整链路

**thething 现状**：
- ✅ 有 `applyCheckpointOnLoad`（checkpoint.ts）
- ❌ 但没有初始化 `compactionView`，导致后续步骤仍需重新压缩

**实现难度**：⭐ 简单（基础已有）
**优先级**：🔥🔥 **高**（与视图机制配合）

---

### 3. 🔥 增量 Token 估算

**问题**：每次策略应用后全量重估所有部分（messages + instructions + tools）

**某项目 解决方案**：
```typescript
async function reestimatePartial(
  prevEstimation: FullRequestEstimation,
  changedPart: 'messages' | 'tools' | 'messagesAndTools',
  newMessages?: UIMessage[],
  newTools?: Record<string, Tool>,
): Promise<FullRequestEstimation> {
  // 只重估变更的部分
  const [messagesTokens, toolsTokens] = await Promise.all([
    changedPart.includes('messages') 
      ? estimateMessagesTokens(newMessages!)
      : prevEstimation.messagesTokens,  // 复用
    changedPart.includes('tools')
      ? estimateToolsTokens(newTools!)
      : prevEstimation.toolsTokens,     // 复用
  ]);
  
  // instructions 和 outputReserve 不变，直接复用
  return { ...prevEstimation, messagesTokens, toolsTokens, ... };
}
```

**收益**：
- ✅ 减少重复 token 计算（instructions 可能 10k+ tokens）
- ✅ 性能提升（尤其是多次策略尝试时）

**thething 现状**：
```typescript
// ❌ 每次都全量重估
currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName);
```

**实现难度**：⭐ 简单
**优先级**：🔥 **中等**（性能优化）

---

### 4. 🔥 Usage 校准器（UsageCalibrator）

**问题**：tokenizer 估算与实际 usage 存在漂移（不同模型/provider 有不同的 overhead）

**某项目 解决方案**：
```typescript
// usage-calibrator.ts
class UsageCalibrator {
  // 收集每次调用的 estimated vs actual tokens
  recordUsage(estimated: number, actual: number) {
    this.samples.push({ estimated, actual });
  }
  
  // 计算漂移比率（滚动窗口，最近 N 次调用）
  getDriftRatio(): number {
    // driftRatio = average(actual / estimated)
    // 估算偏低时 > 1.0，偏高时 < 1.0
  }
}

// 在 compactBeforeStep 中使用
const bufferRatio = driftRatio != null 
  ? driftRatio - 1  // 动态调整
  : getTokenizerBufferRatio(modelName);  // 静态默认值
```

**收益**：
- ✅ 自适应调整 tokenizer buffer
- ✅ 减少不必要的压缩（估算偏高时）
- ✅ 避免超限（估算偏低时）

**thething 现状**：
- 使用固定的 `getTokenizerBufferRatio`（模型名称 → 固定比率）

**实现难度**：⭐⭐ 中等
**优先级**：🔥 **中低**（优化项，非核心）

---

### 5. 详细的遥测日志

**某项目 的实现**：
```typescript
// compaction-telemetry.ts
export function emitCompactionTelemetry(event: {
  conversationId: string;
  timestamp: string;
  eventName: 'api-compact-attempt' | 'api-compact-success' | ...;
  modelName: string;
  contextLimit: number;
  requestTokensBefore: number;
  requestTokensAfter: number;
  tokensFreed: number;
  compactionType: 'auto' | 'manual' | 'reactive';
  details: Record<string, unknown>;
}) {
  // 发送到监控系统
}
```

**收益**：
- ✅ 可观测性（压缩频率、成功率、token 节省量）
- ✅ 问题诊断（哪个 layer 频繁触发？）
- ✅ 成本分析（Layer 3 LLM 调用频率）

**thething 现状**：
- 有基本的 logger.debug/warn
- ❌ 缺少结构化遥测

**实现难度**：⭐⭐ 中等
**优先级**：🔥 **中低**（可观测性）

---

## 实施计划

### Phase 1: 核心视图机制（必需）

**目标**：实现 CompactionView，消除重复 LLM 调用

**任务**：
1. ✅ 创建 `message-view.ts` - 实现 `fingerprintMessage` 和 `applyCompactionView`
2. ✅ 在 `sessionState` 中添加 `compactionView: CompactionView`
3. ✅ 修改 `compactBeforeStep` - 开头应用视图，Layer 3 后更新视图
4. ✅ 修改 `checkpoint.ts` - 应用持久化摘要时初始化视图
5. ✅ 测试：验证跨步骤视图复用（零 LLM 调用）

**预期收益**：
- 减少 80%+ 的 Layer 3 LLM 调用
- KV cache 命中率提升
- 性能提升 2-5x（取决于对话长度）

**优先级**：🔥🔥🔥 **最高**
**预计工作量**：1-2 天

---

### Phase 2: Strategy 0 + 增量估算（优化）

**目标**：完善持久化摘要加载链路，优化 token 估算性能

**任务**：
1. ✅ 修改 `createAgent` - 应用 checkpoint 时初始化视图
2. ✅ 创建 `reestimatePartial` 函数
3. ✅ 修改 `budget-check.ts` - 使用增量估算
4. ✅ 测试：验证跨轮闭环

**预期收益**：
- 跨轮零成本复用摘要
- Token 估算性能提升 30-50%

**优先级**：🔥🔥 **高**
**预计工作量**：0.5-1 天

---

### Phase 3: 可观测性（可选）

**目标**：添加结构化遥测，支持监控和诊断

**任务**：
1. ✅ 创建 `compaction-telemetry.ts`
2. ✅ 在关键点埋点（Layer 2/3 触发、token 节省量）
3. ✅ 集成到现有监控系统

**预期收益**：
- 可观测性提升
- 问题诊断能力

**优先级**：🔥 **中低**
**预计工作量**：0.5 天

---

### Phase 4: Usage 校准器（高级优化）

**目标**：动态调整 tokenizer buffer

**任务**：
1. ✅ 创建 `usage-calibrator.ts`
2. ✅ 集成到 `compactBeforeStep`
3. ✅ 测试不同模型的漂移情况

**预期收益**：
- 自适应 buffer 调整
- 减少不必要压缩

**优先级**：🔥 **低**（优化项）
**预计工作量**：1 天

---

## 不建议实施的部分

### Layer 1: compact_tool_result 工具

**理由**：
1. **复杂度 vs 收益**：Layer 2 自动老化已经够用
2. **LLM 使用率低**：某项目 的数据显示 Layer 1 触发率 < 5%
3. **维护成本**：thething 已经简化架构，不建议回退

**替代方案**：
- 在 system prompt 中引导 LLM 理解 Layer 2 的自动压缩机制
- 如果 LLM 需要压缩特定输出，可以在回复中说明，由 Layer 2 在下一步自动处理

---

## 关键文件对照表

| 功能 | 某项目 | thething | 状态 |
|------|-----------|----------|------|
| 核心入口 | `compaction/index.ts` | `compaction/index.ts` | ✅ 类似 |
| Layer 2 | `tool-output-lifecycle.ts` | `lifecycle.ts` | ✅ 类似 |
| Layer 3 | `summary-pipeline.ts` | `emergency-summary.ts` | ✅ 类似 |
| 视图机制 | `compaction-view.ts` | ❌ 缺失 | 🆕 需实现 |
| 预算检查 | `initial-budget-check.ts` | `budget-check.ts` | ⚠️ 可优化 |
| Token 估算 | `token-counter.ts` | `token-counter.ts` | ✅ 类似 |
| 遥测 | `compaction-telemetry.ts` | ❌ 缺失 | 🆕 可选 |
| Usage 校准 | `usage-calibrator.ts` | ❌ 缺失 | 🆕 可选 |

---

## 总结

**必须实施（Phase 1）**：
- 🔥🔥🔥 **CompactionView 视图机制** - 最大收益
- 🔥🔥 **Strategy 0 + 视图初始化** - 跨轮闭环

**建议实施（Phase 2）**：
- 🔥 **增量 Token 估算** - 性能优化

**可选实施（Phase 3-4）**：
- 🔥 **遥测日志** - 可观测性
- 🔥 **Usage 校准器** - 高级优化

**不建议实施**：
- ❌ **Layer 1 定向压缩** - 复杂度 vs 收益不划算

---

## 参考资料

- 某项目 代码：`E:/某项目/packages/core/src/runtime/compaction/`
- thething 架构文档：`docs/context-compaction-architecture.md`
- 本次修复记录：`.claude/validation/budget-check-fix-validation.md`
