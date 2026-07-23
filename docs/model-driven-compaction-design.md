# 模型驱动压缩设计文档

> 最后更新：2026-07-23  
> 状态：实验性功能设计

## 概览

本文档描述**模型主动压缩**（Model-Driven Compaction）机制的设计，作为现有**系统自动压缩**（System-Driven Compaction）的补充。

核心理念：让模型成为自己的上下文管理者，在理解任务语义的基础上主动清理不再需要的信息，而系统提供兜底保证。

---

## 动机

### 当前系统的局限

现有的四层自动压缩机制（Layer 2-3 + 降级 + Checkpoint）基于硬规则：

```typescript
// 当前压缩策略：时间驱动
{
  keepRecentSteps: 3,              // 保留最近 3 步
  largeOutputThreshold: 8000,      // >8KB 立即压缩
  messageBudget: 100_000,          // 总预算
}
```

**问题**：规则无法理解语义

- ❌ 第 5 步的重要决策在第 8 步被压缩（超过 3 步边界）
- ❌ 10 个文件读取被当作一个整体，无法区分核心文件 vs 临时浏览
- ❌ 85% 水位才触发，此时已经接近危险边界

### 模型的优势

模型知道：
- ✅ 哪些信息对后续任务重要（"我需要记住这个设计决策"）
- ✅ 哪些文件是核心代码，哪些只是临时查看
- ✅ 当前任务处于哪个阶段（探索 vs 实现 vs 调试）

**机会**：让模型在 60-70% 水位时主动清理，避免被动触发紧急压缩。

---

## 架构设计

### 混合模式：主动 + 被动

```
┌─────────────────────────────────────────────────────────────┐
│                    压缩决策层次                              │
├─────────────────────────────────────────────────────────────┤
│ Layer 0: 模型主动压缩（60-80% 水位）                        │
│   - 模型看到上下文使用率 >60%                               │
│   - 可调用 CompactContext 工具                              │
│   - 指定压缩策略和目标                                      │
│   - 系统执行并返回结果                                      │
│   优势：语义理解，精准压缩                                  │
│   风险：模型可能判断错误或忽略                              │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: 系统自动压缩（85% 水位触发）                       │
│   - Layer 2: 工具输出生命周期管理                           │
│   - Layer 2.5: 确定性文本压缩                               │
│   - Layer 3: 紧急 LLM 摘要                                  │
│   - 降级: 强制截断                                          │
│   优势：100% 可靠，永不 413                                 │
│   劣势：规则驱动，可能压缩重要信息                          │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户消息 → Agent 推理
      ↓
  [每步开始前]
      ↓
  估算上下文使用率
      ↓
  ┌─────────────────────────┐
  │ >60% ? 注入上下文水位提示│
  │ 告知模型可以主动压缩     │
  └─────────────────────────┘
      ↓
  模型决策
      ↓
  ┌─────────────────────────┬─────────────────────────┐
  │ 选项 A: 调用 CompactContext 工具              │
  │   → 系统执行压缩                              │
  │   → 释放空间                                  │
  │   → 继续任务                                  │
  └─────────────────────────┴─────────────────────────┘
      ↓
  ┌─────────────────────────┬─────────────────────────┐
  │ 选项 B: 忽略提示，继续任务                     │
  │   → 上下文继续增长                            │
  │   → 85% 时系统自动压缩（兜底）                │
  └─────────────────────────┴─────────────────────────┘
```

---

## CompactContext 工具设计

### 工具签名

```typescript
interface CompactContextInput {
  strategy: 'compress_old_outputs' | 'summarize_conversation' | 'archive_files';
  target: {
    toolNames?: string[];           // 压缩指定工具的输出
    filePatterns?: string[];        // 归档匹配的文件
    messageRange?: { from: number; to: number };  // 摘要消息范围
  };
  reason: string;                   // 压缩原因（审计日志）
}

interface CompactContextOutput {
  success: boolean;
  compressedCount?: number;         // 压缩的项目数
  tokensFreed?: number;             // 释放的 token 数（估算）
  newUsagePercent?: number;         // 压缩后的使用率
  error?: string;
}
```

### 三种压缩策略

#### 1. compress_old_outputs - 压缩旧工具输出

**适用场景**：
- 读了大量文件探索代码库，现在要开始实现
- 执行了多次 Grep/Glob 查找，已经找到目标

**行为**：
- 将指定工具的旧输出替换为元信息
- 保留最近 2 步（安全边界）
- 原始内容自动落盘，可通过 Read 恢复

**示例**：

```typescript
// 用户刚完成代码库探索（读了 15 个文件）
// 模型判断：探索阶段结束，可以压缩旧的 Read 输出

CompactContext({
  strategy: 'compress_old_outputs',
  target: {
    toolNames: ['Read', 'Grep']
  },
  reason: 'Codebase exploration completed, starting implementation phase'
})

// 结果：
// Read src/index.ts → 350 lines [Full output saved to: ...]
// Read src/utils.ts → 120 lines [Full output saved to: ...]
// Grep 'TODO' → 8 matches in 3 files
```

**压缩效果**：
```
Before: 15 个完整文件内容 = ~50,000 tokens
After:  15 条元信息 = ~300 tokens
释放: ~49,700 tokens (99.4%)
```

#### 2. summarize_conversation - 摘要历史对话

**适用场景**：
- 长时间讨论方案（10+ 轮对话）
- 早期对话的详细过程不再需要，只需结论

**行为**：
- 调用 LLM 生成指定消息范围的摘要
- 替换原消息为摘要消息
- 保留首尾消息（任务目标 + 当前状态）

**示例**：

```typescript
// 用户经过 20 轮对话讨论了 3 个方案，最终选择方案 B
// 模型判断：方案讨论的详细过程可以摘要

CompactContext({
  strategy: 'summarize_conversation',
  target: {
    messageRange: { from: 5, to: 25 }
  },
  reason: 'Design discussion concluded, only need final decision'
})

// 生成摘要：
// [Model-initiated summary]
// ## 讨论过程
// - 方案 A: 使用 Redux，被否决（性能问题）
// - 方案 B: 使用 Context + Hooks，最终采用
// - 方案 C: 使用 MobX，被否决（学习曲线）
// 
// ## 最终决策
// 采用方案 B: Context + Hooks
// 原因：简单、性能好、团队熟悉
```

**压缩效果**：
```
Before: 20 条详细对话 = ~15,000 tokens
After:  1 条摘要 + 首尾消息 = ~2,000 tokens
释放: ~13,000 tokens (86.7%)
```

#### 3. archive_files - 归档文件内容

**适用场景**：
- 读了大量文档/配置文件，现在只需要核心代码
- 参考了示例代码，现在要自己实现

**行为**：
- 将匹配 pattern 的文件内容保存到磁盘
- 消息中保留文件路径和归档位置
- 需要时可通过 Read 重新加载

**示例**：

```typescript
// 用户读了所有文档理解 API，现在要开始编码
// 模型判断：文档内容可以归档，需要时再读

CompactContext({
  strategy: 'archive_files',
  target: {
    filePatterns: ['docs/**/*.md', 'examples/**/*.ts']
  },
  reason: 'Documentation reviewed, focusing on implementation now'
})

// 结果：
// Read docs/api.md → [Archived to: .claude/sessions/abc123/tool-results/msg_xyz.json]
// Read docs/guide.md → [Archived to: .claude/sessions/abc123/tool-results/msg_abc.json]
// Use Read tool to recover if needed.
```

**压缩效果**：
```
Before: 10 个文档文件 = ~30,000 tokens
After:  10 条归档引用 = ~500 tokens
释放: ~29,500 tokens (98.3%)
```

---

## 上下文水位提示

### 当前实现（简单提示）

```typescript
// packages/core/src/modules/agent-control/pipeline.ts:62-73

if (budgetSummary.usagePercentage > 60) {
  const contextHint = `[Context Usage: ${budgetSummary.usagePercentage.toFixed(0)}%${warningLevel}]\n` +
    (budgetSummary.usagePercentage > 75
      ? `Note: Large tool outputs can be recovered from disk if needed.\n`
      : '');
  messages.push({ role: 'user', content: contextHint });
}
```

**问题**：
- ❌ 只是告知状态，没有给出行动建议
- ❌ 模型不知道可以做什么

### 改进提示（可操作建议）

```typescript
if (budgetSummary.usagePercentage > 60) {
  const warningLevel =
    budgetSummary.usagePercentage > 85 ? ' 🔴 CRITICAL' :
    budgetSummary.usagePercentage > 75 ? ' 🟠 HIGH' :
    ' 🟡 MODERATE';

  let contextHint = `╔════════════════════════════════════════════════════════════════╗
║ Context Budget Status${warningLevel.padStart(38)}║
╠════════════════════════════════════════════════════════════════╣
║ Usage: ${budgetSummary.usagePercentage.toFixed(1)}% of ${budgetSummary.limit.toLocaleString()} tokens${' '.repeat(30)}║
╠════════════════════════════════════════════════════════════════╣`;

  // 75% 以上：建议主动压缩
  if (budgetSummary.usagePercentage > 75) {
    contextHint += `
║ ⚠️  Context is filling up. Consider proactive compression:     ║
║                                                                 ║
║ 1. CompactContext with strategy: "compress_old_outputs"        ║
║    → Compress old tool results (Read/Grep/Bash outputs)        ║
║    → Example: After exploring codebase, before implementation  ║
║                                                                 ║
║ 2. CompactContext with strategy: "summarize_conversation"      ║
║    → Summarize long discussions or decision-making processes   ║
║    → Example: After choosing design approach                   ║
║                                                                 ║
║ 3. CompactContext with strategy: "archive_files"               ║
║    → Archive documentation/examples to disk                    ║
║    → Example: After reading API docs                           ║
║                                                                 ║
║ If you don't compress, system will auto-compress at 85%        ║
║ (less intelligent, rule-based)                                 ║
╠════════════════════════════════════════════════════════════════╣`;
  }

  // 60-75%：轻提示
  if (budgetSummary.usagePercentage <= 75) {
    contextHint += `
║ 💡 Tip: Large tool outputs are automatically saved to disk     ║
║    and can be recovered if needed. Check for "[saved to: ...]" ║
╠════════════════════════════════════════════════════════════════╣`;
  }

  contextHint += `
║ Current usage: ${budgetSummary.totalTokens.toLocaleString()} tokens (Messages: ${budgetSummary.messagesTokens.toLocaleString()})${' '.repeat(10)}║
╚════════════════════════════════════════════════════════════════╝`;

  messages.push({
    role: 'user',
    content: contextHint,
  } as ModelMessageType);

  debugLog(debugEnabled, `[Agent] Context usage ${budgetSummary.usagePercentage.toFixed(1)}%, injected hint`);
}
```

---

## 保护机制

### 1. 压缩前验证

防止模型错误使用：

```typescript
function validateCompactionRequest(
  request: CompactContextInput,
  sessionState: PipelineContext
): { valid: boolean; error?: string } {
  
  // 规则 1: 不允许在低水位时压缩（浪费 turn）
  if (sessionState.budgetSummary.usagePercentage < 50) {
    return {
      valid: false,
      error: `Context usage is only ${sessionState.budgetSummary.usagePercentage.toFixed(1)}%, no need to compress yet. Wait until >60%.`,
    };
  }

  // 规则 2: 不允许压缩最近 2 步（安全边界）
  if (request.strategy === 'compress_old_outputs') {
    const minAge = 2;
    // 检查 target 中的工具输出是否都 >= 2 步前
    // ...实现略
  }

  // 规则 3: 防止频繁压缩（可能是循环）
  const recentCompressions = sessionState.compressionHistory.filter(
    h => h.timestamp > Date.now() - 60000 // 1 分钟内
  );
  
  if (recentCompressions.length >= 2) {
    return {
      valid: false,
      error: 'Too many compressions in short time (>= 2 in 1 min). Let system auto-compress at 85%.',
    };
  }

  // 规则 4: 摘要消息数量检查
  if (request.strategy === 'summarize_conversation') {
    const range = request.target.messageRange;
    if (!range) {
      return { valid: false, error: 'messageRange required for summarize_conversation' };
    }

    const messageCount = range.to - range.from;
    if (messageCount < 5) {
      return {
        valid: false,
        error: `Too few messages to summarize (${messageCount} < 5). Not worth the compression cost.`,
      };
    }
  }

  // 规则 5: 文件归档 pattern 检查
  if (request.strategy === 'archive_files') {
    if (!request.target.filePatterns || request.target.filePatterns.length === 0) {
      return { valid: false, error: 'filePatterns required for archive_files' };
    }

    // 防止归档核心代码（只允许归档文档/测试/示例）
    const dangerousPatterns = ['src/**/*.ts', 'lib/**/*.js', '*.ts', '*.js'];
    const hasDangerous = request.target.filePatterns.some(p =>
      dangerousPatterns.some(dp => p.includes(dp) || minimatch(p, dp))
    );

    if (hasDangerous) {
      return {
        valid: false,
        error: 'Cannot archive core source code. Only docs/tests/examples are allowed.',
      };
    }
  }

  return { valid: true };
}
```

### 2. 压缩历史记录

```typescript
interface CompressionRecord {
  timestamp: number;
  strategy: string;
  tokensFreed: number;
  triggeredBy: 'model' | 'system';
  reason?: string;
}

// 记录在 sessionState 中
sessionState.compressionHistory.push({
  timestamp: Date.now(),
  strategy: request.strategy,
  tokensFreed: result.tokensFreed,
  triggeredBy: 'model',
  reason: request.reason,
});
```

### 3. 审计日志

```typescript
logger.info('CompactContext', {
  action: 'model_initiated_compression',
  strategy: request.strategy,
  reason: request.reason,
  before: {
    usagePercent: beforeUsage,
    totalTokens: beforeTokens,
  },
  after: {
    usagePercent: afterUsage,
    totalTokens: afterTokens,
  },
  tokensFreed: result.tokensFreed,
  itemsCompressed: result.compressedCount,
});
```

---

## 实施计划

### Phase 1: 核心实现（P0）

#### 1.1 创建 CompactContext 工具

**文件**: `packages/core/src/modules/tools/compact-context.ts`

- [ ] 定义工具 schema（3 种策略）
- [ ] 实现 `compressOldOutputs` 函数
- [ ] 实现 `summarizeMessageRange` 函数
- [ ] 实现 `archiveFileContents` 函数
- [ ] 添加验证逻辑 `validateCompactionRequest`

**预计工作量**: 1-2 天

#### 1.2 改进上下文水位提示

**文件**: `packages/core/src/modules/agent-control/pipeline.ts`

- [ ] 替换现有的简单提示（line 62-73）
- [ ] 添加可操作建议（3 种压缩策略说明）
- [ ] 根据水位等级调整提示详细程度
  - 60-75%: 轻提示（只告知状态）
  - 75-85%: 重提示（建议压缩）
  - 85%+: 紧急提示（即将自动压缩）

**预计工作量**: 0.5 天

#### 1.3 添加配置开关

**文件**: `packages/core/src/services/config/behavior.ts`

```typescript
interface BehaviorConfig {
  // ... 现有配置

  /** 启用模型主动压缩（实验性） */
  enableModelDrivenCompaction?: boolean;  // 默认 false

  /** 模型压缩的触发水位 */
  modelCompactionThreshold?: number;      // 默认 0.60 (60%)
}
```

**预计工作量**: 0.5 天

#### 1.4 集成到工具集

**文件**: `packages/core/src/modules/tools/index.ts`

```typescript
export function createToolSet(context: ToolContext): Record<string, Tool> {
  const tools = {
    Read: createReadTool(context),
    Write: createWriteTool(context),
    // ... 其他工具
  };

  // 条件性添加 CompactContext 工具
  if (context.config.enableModelDrivenCompaction) {
    tools.CompactContext = createCompactContextTool({
      sessionState: context.sessionState,
      dataStore: context.dataStore,
    });
  }

  return tools;
}
```

**预计工作量**: 0.5 天

---

### Phase 2: 测试与验证（P1）

#### 2.1 单元测试

**文件**: `packages/core/src/modules/tools/__tests__/compact-context.test.ts`

测试场景：
- [ ] `compress_old_outputs` 正确压缩旧工具输出
- [ ] `summarize_conversation` 生成合理摘要
- [ ] `archive_files` 正确匹配文件 pattern
- [ ] 验证规则正确拦截非法请求
- [ ] 频率限制正常工作

**预计工作量**: 1 天

#### 2.2 集成测试

**文件**: `packages/core/src/modules/tools/__tests__/compact-context.integration.test.ts`

测试场景：
- [ ] 完整压缩流程：提示 → 工具调用 → 压缩执行 → 结果验证
- [ ] 模型压缩失败时，系统自动压缩兜底
- [ ] 长对话场景（100 轮）下的压缩效果
- [ ] 多次压缩的累积效果

**预计工作量**: 1 天

#### 2.3 人工测试

测试任务：
- [ ] 代码库探索任务（读 20+ 文件）
- [ ] 长讨论任务（30+ 轮对话）
- [ ] 文档密集任务（读大量 Markdown）

验证指标：
- 模型是否主动调用 CompactContext
- 压缩时机是否合理
- 是否压缩了重要信息（误压缩率）
- 与系统自动压缩相比的效果

**预计工作量**: 2 天

---

### Phase 3: 数据收集与优化（P2）

#### 3.1 遥测数据

收集以下指标：

```typescript
interface CompactionMetrics {
  // 调用频率
  modelCompactionCalls: number;         // 模型主动压缩次数
  systemCompactionCalls: number;        // 系统自动压缩次数

  // 效果
  avgTokensFreedPerCall: number;        // 平均每次释放 tokens
  avgCompressionLatency: number;        // 平均压缩耗时

  // 时机
  avgTriggerUsagePercent: number;       // 平均触发时的水位
  earlyCompressionRate: number;         // 早压缩率（<75% 时压缩）

  // 策略分布
  strategyDistribution: {
    compress_old_outputs: number;
    summarize_conversation: number;
    archive_files: number;
  };

  // 失败率
  validationFailureRate: number;        // 验证未通过率
  compressionErrorRate: number;         // 压缩执行失败率
}
```

**实现**: `packages/core/src/modules/telemetry/compaction-metrics.ts`

#### 3.2 A/B 测试

对比两组用户：
- **对照组**: `enableModelDrivenCompaction = false`（只有系统自动压缩）
- **实验组**: `enableModelDrivenCompaction = true`（模型 + 系统）

对比指标：
- 平均会话长度（步数）
- 平均上下文利用率
- 紧急压缩触发次数（85%+ 触发）
- 用户体验反馈

**预计工作量**: 持续 2-4 周

#### 3.3 优化方向

根据数据调整：

**如果效果好**（模型压缩准确率 >85%）：
- [ ] 默认启用 `enableModelDrivenCompaction = true`
- [ ] 添加更多压缩策略（按文件类型、按访问频率）
- [ ] 降低系统自动压缩的触发水位（85% → 90%）

**如果效果一般**（准确率 70-85%）：
- [ ] 保持默认关闭
- [ ] 改进提示词，引导模型更好判断
- [ ] 添加更多验证规则

**如果效果差**（准确率 <70%）：
- [ ] 限制为高级用户功能
- [ ] 只在特定模型（Opus/GPT-4o）启用
- [ ] 简化为单一策略（只保留 compress_old_outputs）

---

## 使用示例

### 场景 1: 代码库探索后开始实现

```
User: 帮我重构这个模块，先了解一下现有代码