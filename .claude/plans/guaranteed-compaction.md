# 保证上下文压缩成功的方案设计

## 问题陈述

当前系统在长对话中会失败，原因：
1. **Layer 2** 只压缩工具输出（保留最近 3 步完整输出）
2. **Layer 3（同步 LLM 摘要）** 已删除（因为濒死时刻调用 LLM 太慢、容易失败）
3. **Checkpoint（异步摘要）** 只在运行结束后执行

**结果**：如果对话内容本身太长（非工具输出），Layer 2 无能为力 → 直接返回 413 错误

**用户需求**：无论多长的对话，系统都必须能够压缩到窗口以内，保证任务继续执行

## 核心矛盾

文档 `docs/context-invariant-architecture.md:454-464` 承认了这个问题，但认为是"设计取舍"：

> 同步 LLM 摘要在濒死时刻的可靠性（事故中 0% 成功率）低于"诚实告诉用户开始新会话"。

**但这个取舍是错误的**，理由：
- 用户在执行长任务时不应该被强制中断
- 即使摘要慢，也比任务失败要好
- 0% 成功率是因为实现有问题，不是方案本身不可行

## 方案对比

### 方案 A：重新引入 Layer 3（智能同步摘要）

**核心思路**：在 Layer 2 无法满足预算时，调用 LLM 生成摘要，但要避免原先的问题。

**改进点**：
1. **分级压缩**：先压缩对话中间部分，保留开头（目标）和结尾（当前上下文）
2. **快速模型**：使用快速小模型（如 claude-haiku）生成摘要，而非慢速大模型
3. **超时保护**：设置 30 秒超时，失败则降级到方案 B
4. **渐进式压缩**：每次只压缩 30-50% 的内容，而非全部
5. **缓存优化**：摘要后的前缀保持稳定，提升 prompt cache 命中率

**优点**：
- ✅ 保证任务不中断
- ✅ 大多数情况下可以成功
- ✅ 语义保留最好

**缺点**：
- ❌ 仍然可能失败（网络问题、模型不可用）
- ❌ 用户需要等待（但可以显示进度）
- ❌ 增加成本

**实施难度**：中等（需要重构 context-window.ts，但已有基础代码）

---

### 方案 B：确定性文本压缩（无 LLM）

**核心思路**：使用确定性算法压缩对话，不依赖 LLM。

**策略**：
1. **保留关键消息**：
   - 第一条 user 消息（任务目标）
   - 最后 N 条消息（当前上下文）
   - 包含文件路径、命令结果的消息
2. **中间消息摘要**：
   - 提取文件路径列表
   - 提取命令列表
   - 提取关键决策（"decided to...", "因为..."）
3. **工具输出压缩**：
   - Layer 2 激进模式（keepRecentSteps: 0）

**优点**：
- ✅ 100% 可靠，无网络依赖
- ✅ 速度快（毫秒级）
- ✅ 无额外成本

**缺点**：
- ❌ 可能丢失语义信息
- ❌ 压缩率有限（纯文本对话很难压缩）

**实施难度**：低

---

### 方案 C：混合方案（推荐）

**核心思路**：结合 A 和 B 的优点，分阶段处理。

**流程**：
```
1. Layer 2 激进压缩（keepRecentSteps: 0）
   ↓ 仍超限
2. 确定性文本压缩（方案 B）
   - 保留首尾，中间提取关键信息
   ↓ 仍超限
3. 智能同步摘要（方案 A）
   - 使用快速模型（claude-haiku-4）
   - 30 秒超时
   - 仅压缩中间 50% 的内容
   ↓ 成功或超时
4. 降级：强制截断（保留首尾各 20%）
   - 显示警告："由于对话过长，中间部分已省略"
   - 但任务继续执行
```

**优点**：
- ✅ 大多数情况下在步骤 1-2 解决（快速、可靠）
- ✅ 步骤 3 处理极端情况（长纯文本对话）
- ✅ 步骤 4 保证永远不会返回 413

**缺点**：
- ❌ 复杂度较高

**实施难度**：中等

---

## 最终决策：方案 C（混合方案）+ 强制截断保底

**决策理由**：
1. **符合"保证任务优先"原则**：4 层降级保证永远不返回 413
2. **实用主义**：大多数情况在 Layer 2 解决（快速），极端情况有保底
3. **尊重现有架构**：Layer 2 已存在，context-window.ts 可复用，checkpoint 保持独立

**保底行为**：强制截断（保留首尾各 20%）+ 显示警告
- 保留任务目标（开头）+ 当前上下文（结尾）
- 警告让用户知道发生了什么，可以选择新开会话
- 比返回 413 更好：任务继续执行

---

## 推荐方案：方案 C（混合方案）

### 实施细节

#### 1. 新增 `Layer 2.5`：确定性文本压缩

文件：`packages/core/src/modules/compaction/message-compressor.ts`

```typescript
/**
 * 确定性文本压缩：不调用 LLM，100% 可靠
 */
export function compressMessagesDeteerministic(
  messages: PipelineMessage[],
  targetTokens: number,
  modelName: string,
): { messages: PipelineMessage[]; tokensFreed: number } {
  // 1. 保留首尾
  const firstUserMsg = messages.find(m => m.role === 'user');
  const recentCount = Math.min(10, Math.floor(messages.length * 0.2));
  const recentMessages = messages.slice(-recentCount);
  
  // 2. 中间消息提取关键信息
  const middleMessages = messages.slice(
    messages.indexOf(firstUserMsg) + 1,
    messages.length - recentCount
  );
  
  const keyInfo = extractKeyInformation(middleMessages);
  const summaryMessage = buildSummaryMessage(
    `[压缩的历史消息]\n${keyInfo}`,
    'pipeline'
  );
  
  // 3. 重新组装
  return {
    messages: [firstUserMsg, summaryMessage, ...recentMessages],
    tokensFreed: estimateFreedTokens(middleMessages)
  };
}

function extractKeyInformation(messages: PipelineMessage[]): string {
  const info = {
    files: new Set<string>(),
    commands: [] as string[],
    decisions: [] as string[],
  };
  
  for (const msg of messages) {
    const text = extractMessageText(msg);
    
    // 提取文件路径
    const filePaths = text.match(/[\w\-]+\.(ts|js|tsx|jsx|py|md|json)/g);
    filePaths?.forEach(f => info.files.add(f));
    
    // 提取命令（简化版）
    if (msg.role === 'tool') {
      const preview = text.slice(0, 100);
      if (preview.includes('exit code')) {
        info.commands.push(preview);
      }
    }
    
    // 提取决策
    if (text.includes('decided to') || text.includes('因为')) {
      info.decisions.push(text.slice(0, 200));
    }
  }
  
  return [
    `涉及文件: ${[...info.files].join(', ')}`,
    `执行命令: ${info.commands.length} 条`,
    `关键决策: ${info.decisions.slice(0, 3).join('\n')}`,
  ].join('\n');
}
```

#### 2. 增强 `Layer 3`：智能同步摘要

文件：`packages/core/src/modules/compaction/emergency-summary.ts`

```typescript
/**
 * 紧急摘要：快速、有超时保护、渐进式
 */
export async function emergencySummarize(
  messages: PipelineMessage[],
  context: {
    model: LanguageModelV3;
    targetPercent: number; // 0.5 = 压缩到 50%
  },
): Promise<{ messages: PipelineMessage[]; success: boolean }> {
  // 1. 保留首尾
  const firstUserMsg = messages.find(m => m.role === 'user');
  const recentCount = Math.min(15, Math.floor(messages.length * 0.3));
  const recentMessages = messages.slice(-recentCount);
  
  // 2. 只压缩中间部分
  const middleStart = messages.indexOf(firstUserMsg) + 1;
  const middleEnd = messages.length - recentCount;
  const middleMessages = messages.slice(middleStart, middleEnd);
  
  if (middleMessages.length < 5) {
    // 太短，不值得摘要
    return { messages, success: false };
  }
  
  // 3. 调用快速模型，30 秒超时
  try {
    const summary = await Promise.race([
      generateSummaryFast(middleMessages, context.model),
      timeout(30000, '摘要超时'),
    ]);
    
    const summaryMessage = buildSummaryMessage(summary, 'pipeline');
    
    return {
      messages: [firstUserMsg, summaryMessage, ...recentMessages],
      success: true,
    };
  } catch (err) {
    logger.warn('EmergencySummary', '摘要失败，降级到确定性压缩', err);
    return { messages, success: false };
  }
}

async function generateSummaryFast(
  messages: PipelineMessage[],
  model: LanguageModelV3,
): Promise<string> {
  // 使用简化的 prompt，减少输入
  const conversationText = messages
    .map(m => `${m.role}: ${extractMessageText(m).slice(0, 500)}`)
    .join('\n');
  
  const { text } = await generateText({
    model,
    instructions: '简要总结以下对话，提取：1)任务目标 2)已完成步骤 3)涉及文件',
    prompt: conversationText,
    maxOutputTokens: 1000, // 限制输出
  });
  
  return text.trim();
}
```

#### 3. 更新 `compactBeforeStep`

文件：`packages/core/src/modules/compaction/index.ts`

```typescript
export async function compactBeforeStep(
  messages: PipelineMessage[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context: {
    // ... 现有参数
  },
): Promise<PipelineMessage[]> {
  let current = messages;
  
  // Step 1: Layer 2 正常模式
  const lifecycle = manageToolOutputLifecycle(current, config.lifecycle, context.storage);
  current = lifecycle.messages;
  await lifecycle.persistence;
  
  // Step 2: 检查预算
  const estimation = await estimateFullRequest(
    current,
    context.instructions,
    context.tools,
    context.modelName,
    context.contextLimit,
  );
  
  if (!estimation.exceedsLimit) {
    // 正常情况，直接返回
    return current;
  }
  
  logger.warn('Compaction', `超限 ${estimation.utilizationPercent}%，启动紧急压缩`);
  
  // Step 3: Layer 2 激进模式
  const aggressiveLifecycle = manageToolOutputLifecycle(
    current,
    { ...config.lifecycle, keepRecentSteps: 0 },
    context.storage,
  );
  current = aggressiveLifecycle.messages;
  
  const afterAggressive = await estimateFullRequest(
    current,
    context.instructions,
    context.tools,
    context.modelName,
    context.contextLimit,
  );
  
  if (!afterAggressive.exceedsLimit) {
    logger.info('Compaction', `Layer 2 激进模式成功，降至 ${afterAggressive.utilizationPercent}%`);
    return current;
  }
  
  // Step 4: Layer 2.5 确定性文本压缩
  const { messages: deterministicCompressed, tokensFreed } = compressMessagesDeterministic(
    current,
    context.contextLimit * 0.7,
    context.modelName,
  );
  current = deterministicCompressed;
  
  const afterDeterministic = await estimateFullRequest(
    current,
    context.instructions,
    context.tools,
    context.modelName,
    context.contextLimit,
  );
  
  if (!afterDeterministic.exceedsLimit) {
    logger.info('Compaction', `确定性压缩成功，释放 ${tokensFreed} tokens`);
    return current;
  }
  
  // Step 5: Layer 3 智能摘要（最后手段）
  if (context.model) {
    logger.warn('Compaction', '启动紧急 LLM 摘要（可能需要 30 秒）');
    
    const { messages: summarized, success } = await emergencySummarize(current, {
      model: context.model,
      targetPercent: 0.6,
    });
    
    if (success) {
      current = summarized;
      const afterSummary = await estimateFullRequest(
        current,
        context.instructions,
        context.tools,
        context.modelName,
        context.contextLimit,
      );
      
      if (!afterSummary.exceedsLimit) {
        logger.info('Compaction', `紧急摘要成功，降至 ${afterSummary.utilizationPercent}%`);
        return current;
      }
    }
  }
  
  // Step 6: 降级方案 - 强制截断（保证永不失败）
  logger.error('Compaction', '所有压缩策略失败，执行强制截断');
  
  const firstUserMsg = current.find(m => m.role === 'user');
  const keepTail = Math.min(8, Math.floor(current.length * 0.15));
  const truncated = [
    firstUserMsg,
    buildSummaryMessage('[由于对话过长，中间部分已省略]', 'pipeline'),
    ...current.slice(-keepTail),
  ];
  
  return truncated;
}
```

---

## 关键设计决策

### 1. 为什么保留首尾？
- **首条 user 消息**：包含任务目标和验收标准
- **最后 N 条消息**：当前工作上下文，模型需要知道"刚才做了什么"

### 2. 为什么用快速模型？
- Haiku 4 的速度是 Opus 的 5-10 倍
- 摘要任务不需要复杂推理能力
- 30 秒超时可以接受

### 3. 为什么分阶段？
- 大多数情况在 Step 1-2 解决（99% 的场景）
- Step 3-5 处理极端情况（长纯文本对话）
- Step 6 保证永远不会返回 413

### 4. 与 Checkpoint 的关系
- Checkpoint 仍然是最佳方案（后台异步，无感知）
- 本方案是"濒死时刻的最后防线"
- 两者互补，不冲突

---

## 测试策略

### 单元测试
- `message-compressor.test.ts`：确定性压缩逻辑
- `emergency-summary.test.ts`：摘要超时、失败处理

### 集成测试
- 模拟 420K tokens 的长对话
- 验证每一层的压缩效果
- 验证最终永不返回 413

### 性能测试
- Layer 2 激进模式：< 10ms
- 确定性压缩：< 50ms
- LLM 摘要：< 30s（超时）

---

## 实施步骤

1. **Phase 1**：实现 Layer 2.5（确定性压缩）
   - 新增 `message-compressor.ts`
   - 编写单元测试
   - 集成到 `compactBeforeStep`

2. **Phase 2**：实现 Layer 3（紧急摘要）
   - 新增 `emergency-summary.ts`
   - 复用 `context-window.ts` 的基础代码
   - 添加超时保护

3. **Phase 3**：添加降级方案
   - 强制截断逻辑
   - 用户友好的警告消息

4. **Phase 4**：集成测试
   - 端到端测试长对话场景
   - 性能基准测试

---

## 风险与缓解

### 风险 1：LLM 摘要仍然失败
**缓解**：确定性压缩 + 强制截断兜底，保证永不返回 413

### 风险 2：用户体验下降（等待 30 秒）
**缓解**：
- 显示进度提示："正在压缩上下文..."
- 大多数情况在 Layer 2/2.5 解决，用户无感知

### 风险 3：语义丢失
**缓解**：
- 保留首尾消息
- 提取关键信息（文件路径、命令、决策）
- Checkpoint 机制在后台生成高质量摘要

---

## 总结

**核心原则**：任务优先，永不返回 413

**实现路径**：
1. 快速可靠的压缩（Layer 2 + 2.5）
2. 智能摘要（Layer 3，有超时保护）
3. 降级方案（强制截断）

**预期效果**：
- 99% 的场景在 < 100ms 内解决
- 1% 的极端场景需要 30 秒
- 0% 的场景返回 413 错误
