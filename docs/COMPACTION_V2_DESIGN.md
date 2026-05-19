# 上下文压缩 V2：完整生产设计

## 1. 核心思想

V1 是事后补救 — 让消息无限膨胀，爆了再用 14 个文件、6 步 pipeline 缩减。

V2 是源头管理 — **在每一步 API 调用前，自动将旧工具输出替换为结构化元信息**。上下文增长极慢，极少需要 LLM 压缩。

```
V1: 消息膨胀 ──→ 检测超限 ──→ 6步pipeline ──→ 压缩
V2: 每步自动管理工具输出 ──→ 上下文保持精简 ──→ 极少需要 LLM 介入
```

---

## 2. 架构总览

```
createChatAgent (首次加载)
  └─ initialBudgetCheck()
      1. Layer 2: 压缩旧工具输出（同步，微秒级）
      2. 工具过滤：超限时移除低优先级工具（同步）
      3. Layer 3: LLM 摘要（仅在 Layer 2 不够时）
      4. 紧急截断（最后手段）

prepareStep (每步 API 调用前)
  └─ compactBeforeStep()
      1. 应用 Agent 主动释放（Layer 1，如果有）
      2. manageToolOutputLifecycle（Layer 2，核心）
      3. enforceContextWindow（Layer 3，极少触发）

API 调用失败 (context-length error)
  └─ reactiveRetry()
      1. 激进 Layer 2（keepRecentTurns 降为 1）
      2. Layer 3 紧急摘要
      3. 重试一次
```

---

## 3. 文件结构

```
packages/core/src/runtime/compaction/
  ├── types.ts                    # 类型定义（简化，复用 V1 的 PromptBudgetPolicy 等）
  ├── tool-output-lifecycle.ts    # Layer 2: 工具输出生命周期管理（核心创新）
  ├── context-window.ts           # Layer 3: 滑动窗口 + LLM 摘要
  ├── initial-budget-check.ts     # 首次加载预算检查（简化版）
  ├── reactive-retry.ts           # API 错误处理（保留 V1，已经很简洁）
  └── index.ts                    # 入口：compactBeforeStep + 导出
```

保留 V1 的独立模块（不修改，直接复用）：
- `prompt-budget-policy.ts` — 预算策略推导
- `request-budget.ts` — 请求 token 估算
- `token-counter.ts` — Token 计数基础设施
- `compaction-telemetry.ts` — 遥测

V1 中删除的模块：
- ~~`micro-compact.ts`~~ → 被 `tool-output-lifecycle.ts` 替代
- ~~`session-memory-compact.ts`~~ → Layer 2 使压缩频率大幅降低，SM 的 ROI 不再值得额外复杂度
- ~~`api-compact.ts`~~ → 摘要逻辑简化后合并到 `context-window.ts`
- ~~`ptl-degradation.ts`~~ → 合并到 `initial-budget-check.ts` 的紧急截断
- ~~`auto-compact.ts`~~ → 不需要状态机（Layer 2 同步执行）
- ~~`background-queue.ts`~~ → 不需要后台队列（没有异步 LLM 调用热路径）
- ~~`tool-pair-utils.ts`~~ → 不截断消息，不需要 preserveToolPairs
- ~~`boundary.ts`~~ → Layer 3 摘要直接作为系统消息，不需要特殊 boundary 格式

---

## 4. 类型定义 (types.ts)

```typescript
import type { UIMessage } from 'ai';

// ── 配置 ──

export interface CompactionConfig {
  lifecycle: LifecycleConfig;
  contextWindow: ContextWindowConfig;
}

export interface LifecycleConfig {
  /** 完整保留最近 N 轮的工具输出（默认 3） */
  keepRecentTurns: number;
  /** 大输出阈值：超过此 token 数的工具输出即使在最近 N 轮内也被压缩（默认 8000） */
  largeOutputThreshold: number;
  /** 可压缩的工具名集合。为 null 时使用默认规则（内置工具 + mcp_* + connector_*） */
  compactableTools: Set<string> | null;
  /** 不可压缩的工具名集合，优先级高于 compactableTools（默认为空） */
  protectedTools: Set<string>;
}

export interface ContextWindowConfig {
  /** 触发 Layer 3 摘要的利用率百分比（默认 0.85） */
  triggerPercent: number;
  /** 摘要后的目标利用率百分比（默认 0.60） */
  targetPercent: number;
  /** 摘要 prompt 中保留的上下文提示消息数（默认 2） */
  contextHintMessages: number;
  /** 是否启用增量摘要（默认 true） */
  incrementalSummary: boolean;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  lifecycle: {
    keepRecentTurns: 3,
    largeOutputThreshold: 8000,
    compactableTools: null,
    protectedTools: new Set(),
  },
  contextWindow: {
    triggerPercent: 0.85,
    targetPercent: 0.60,
    contextHintMessages: 2,
    incrementalSummary: true,
  },
};

// ── 工具输出压缩标记 ──

export interface CompactedToolResult {
  /** 结构化元信息摘要 */
  summary: string;
  /** 标记：已压缩，防止重复处理 */
  _compacted: true;
  /** 原始输出大小（chars），用于遥测 */
  _originalSize: number;
}

// ── 压缩结果 ──

export interface CompactionResult {
  messages: UIMessage[];
  tokensFreed: number;
  actions: string[];
}
```

---

## 5. Layer 2: 工具输出生命周期管理 (tool-output-lifecycle.ts)

这是 V2 的核心。每步 API 调用前执行，同步，微秒级。

### 5.1 主函数

```typescript
export function manageToolOutputLifecycle(
  messages: UIMessage[],
  config: LifecycleConfig,
): { messages: UIMessage[]; tokensFreed: number } {
  const recentBoundary = findNthUserMessageFromEnd(messages, config.keepRecentTurns);
  let tokensFreed = 0;

  const result = messages.map((msg, i) => {
    // 不是工具结果 → 原样保留
    if (!hasToolInvocationParts(msg)) return msg;
    // 已经压缩过 → 跳过
    if (isAlreadyCompacted(msg)) return msg;

    // 判断是否应该压缩这条工具输出
    const shouldCompact =
      i < recentBoundary ||                                    // 超出最近 N 轮
      estimateToolResultSize(msg) > config.largeOutputThreshold; // 或者输出太大

    if (!shouldCompact) return msg;
    if (!isToolCompactable(msg, config)) return msg;

    const { compacted, freed } = compressToolResultParts(msg);
    tokensFreed += freed;
    return compacted;
  });

  return { messages: result, tokensFreed };
}
```

### 5.2 可压缩判断

```typescript
function isToolCompactable(msg: UIMessage, config: LifecycleConfig): boolean {
  const toolNames = extractToolNames(msg);
  for (const name of toolNames) {
    // 受保护的工具不压缩
    if (config.protectedTools.has(name)) return false;
  }
  for (const name of toolNames) {
    // 显式配置的可压缩工具
    if (config.compactableTools?.has(name)) return true;
    // 默认规则：内置工具 + MCP + Connector
    if (config.compactableTools === null) {
      if (DEFAULT_COMPACTABLE.has(name)) return true;
      if (name.startsWith('mcp_')) return true;
      if (name.startsWith('connector_')) return true;
    }
  }
  return false;
}

const DEFAULT_COMPACTABLE = new Set([
  'read_file', 'bash', 'grep', 'glob',
  'edit_file', 'write_file',
  'web_search', 'web_fetch',
]);
```

### 5.3 元信息提取

核心：把大块工具输出替换为一行结构化摘要。不调 LLM，纯规则。

```typescript
function compressToolResultParts(msg: UIMessage): { compacted: UIMessage; freed: number } {
  let freed = 0;
  const newParts = msg.parts.map((part) => {
    if (part.type !== 'tool-invocation') return part;
    if (!part.result || part.result._compacted) return part;

    const resultStr = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
    const originalSize = resultStr.length;

    // 小输出不值得压缩（压缩后的元信息可能和原文一样长）
    if (originalSize < 200) return part;

    const summary = extractToolMeta(part.toolName, part.args, part.result);
    freed += Math.max(0, Math.floor(originalSize / 3.5) - Math.floor(summary.length / 3.5));

    return {
      ...part,
      result: { summary, _compacted: true, _originalSize: originalSize } as CompactedToolResult,
    };
  });

  return { compacted: { ...msg, parts: newParts }, freed };
}
```

### 5.4 元信息提取器

按工具类型提取有意义的元信息。未知工具使用通用提取器。

```typescript
type MetaExtractor = (args: any, result: any) => string;

const EXTRACTORS: Record<string, MetaExtractor> = {
  read_file: (args, result) => {
    const content = typeof result === 'string' ? result : result?.content ?? '';
    const lines = content.split('\n').length;
    const ext = args.file_path?.split('.').pop() ?? '';
    return `Read ${args.file_path} → ${lines} lines (.${ext})`;
  },

  bash: (args, result) => {
    const cmd = (args.command ?? '').slice(0, 80);
    const stdout = typeof result === 'string' ? result : result?.stdout ?? '';
    const exit = result?.exitCode ?? (stdout ? 0 : '?');
    const lastLine = stdout.trim().split('\n').pop()?.slice(0, 100) ?? '';
    return `Bash '${cmd}' → exit ${exit}${lastLine ? `: ${lastLine}` : ''}`;
  },

  grep: (args, result) => {
    const matches = Array.isArray(result) ? result : result?.matches ?? [];
    const files = new Set(matches.map((m: any) => m.file ?? m.path)).size;
    return `Grep '${args.pattern}' → ${matches.length} matches in ${files} files`;
  },

  glob: (args, result) => {
    const files = Array.isArray(result) ? result : result?.files ?? [];
    return `Glob '${args.pattern}' → ${files.length} files`;
  },

  edit_file: (args, _result) => {
    return `Edit ${args.file_path} → applied`;
  },

  write_file: (args, _result) => {
    return `Write ${args.file_path} → written`;
  },

  web_search: (args, result) => {
    const count = Array.isArray(result) ? result.length : result?.results?.length ?? 0;
    return `WebSearch '${(args.query ?? '').slice(0, 60)}' → ${count} results`;
  },

  web_fetch: (args, result) => {
    const len = typeof result === 'string' ? result.length : JSON.stringify(result).length;
    return `WebFetch ${(args.url ?? '').slice(0, 80)} → ${len} chars`;
  },
};

/** 通用提取器：保留结果的结构轮廓 */
function defaultExtractor(_args: any, result: any): string {
  if (typeof result === 'string') {
    // 纯文本：保留首尾各 80 字符
    if (result.length <= 200) return result;
    return `${result.slice(0, 80)} ... ${result.slice(-80)} [${result.length} chars total]`;
  }
  if (Array.isArray(result)) {
    return `Array[${result.length}]${result.length > 0 ? `: first=${JSON.stringify(result[0]).slice(0, 80)}` : ''}`;
  }
  if (typeof result === 'object' && result !== null) {
    const keys = Object.keys(result).slice(0, 8);
    return `{${keys.join(', ')}} [${JSON.stringify(result).length} chars]`;
  }
  return `[${typeof result}, ${String(result).length} chars]`;
}

export function extractToolMeta(toolName: string, args: any, result: any): string {
  // 1. 精确匹配
  if (EXTRACTORS[toolName]) return EXTRACTORS[toolName](args, result);
  // 2. 去掉 mcp_ / connector_ 前缀后匹配
  const baseName = toolName.replace(/^(mcp_|connector_)/, '');
  if (EXTRACTORS[baseName]) return EXTRACTORS[baseName](args, result);
  // 3. 通用提取
  return `${toolName}: ${defaultExtractor(args, result)}`;
}
```

**关键设计决策**：通用提取器不再是无意义的 `"X chars (compacted)"`。它保留了结果的结构轮廓 — 首尾文本、数组长度和首元素、对象的 key 列表。Agent 看到这些能判断是否需要重新调用。

### 5.5 辅助函数

```typescript
function findNthUserMessageFromEnd(messages: UIMessage[], n: number): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      count++;
      if (count >= n) return i;
    }
  }
  return 0; // 不到 N 轮 → 全部消息都在"最近"范围内
}

function hasToolInvocationParts(msg: UIMessage): boolean {
  return msg.parts?.some(p => p.type === 'tool-invocation') ?? false;
}

function isAlreadyCompacted(msg: UIMessage): boolean {
  return msg.parts?.every(p =>
    p.type !== 'tool-invocation' || !p.result || p.result._compacted
  ) ?? true;
}

function estimateToolResultSize(msg: UIMessage): number {
  let total = 0;
  for (const p of msg.parts ?? []) {
    if (p.type === 'tool-invocation' && p.result && !p.result._compacted) {
      const str = typeof p.result === 'string' ? p.result : JSON.stringify(p.result);
      total += Math.floor(str.length / 3.5);
    }
  }
  return total;
}

function extractToolNames(msg: UIMessage): string[] {
  return (msg.parts ?? [])
    .filter(p => p.type === 'tool-invocation')
    .map(p => p.toolName)
    .filter(Boolean);
}
```

---

## 6. Layer 3: 上下文窗口管理 (context-window.ts)

当 Layer 2 不够时（纯文本对话增长、大量小工具调用累积），用 LLM 生成摘要。

### 6.1 主函数

```typescript
export async function enforceContextWindow(
  messages: UIMessage[],
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    policy: PromptBudgetPolicy;
    fixedOverhead: { instructionsTokens: number; toolsTokens: number };
    conversationId: string;
    dataStore: DataStore;
    config: ContextWindowConfig;
  },
): Promise<{ messages: UIMessage[]; executed: boolean; tokensFreed: number }> {
  // 估算当前 token 总量
  const estimation = await estimateRequestBudgetWithFixedOverhead({
    messages,
    instructionsTokens: context.fixedOverhead.instructionsTokens,
    toolsTokens: context.fixedOverhead.toolsTokens,
    modelName: context.modelName,
    policy: context.policy,
  });

  const triggerTokens = Math.floor(context.policy.contextLimit * context.config.triggerPercent);
  if (estimation.totalTokens < triggerTokens) {
    return { messages, executed: false, tokensFreed: 0 };
  }

  // 计算目标 token 数
  const targetTokens = Math.floor(context.policy.contextLimit * context.config.targetPercent);
  const targetMessageTokens = targetTokens - context.fixedOverhead.instructionsTokens
    - context.fixedOverhead.toolsTokens - context.policy.outputReserve;

  // 找到分割点：保留后段 token 数 ≈ targetMessageTokens
  const splitIndex = await findSplitIndex(messages, targetMessageTokens, context.modelName);

  if (splitIndex < 3) {
    // 前段太少，不值得摘要
    return { messages, executed: false, tokensFreed: 0 };
  }

  const olderMessages = messages.slice(0, splitIndex);
  const newerMessages = messages.slice(splitIndex);

  // 生成摘要
  const summary = await generateSummaryWithFallback(
    olderMessages, context.model, context.fallbackModels,
    context.conversationId, context.dataStore, context.config,
  );

  const summaryMessage: UIMessage = {
    id: `summary-${Date.now()}`,
    role: 'system',
    parts: [{ type: 'text', text: `[Previous conversation summary]\n${summary}\n[End of summary]` }],
  };

  const result = [summaryMessage, ...newerMessages];
  const newEstimation = await estimateRequestBudgetWithFixedOverhead({
    messages: result,
    instructionsTokens: context.fixedOverhead.instructionsTokens,
    toolsTokens: context.fixedOverhead.toolsTokens,
    modelName: context.modelName,
    policy: context.policy,
  });

  const tokensFreed = Math.max(0, estimation.messagesTokens - newEstimation.messagesTokens);

  return { messages: result, executed: true, tokensFreed };
}
```

### 6.2 摘要生成（带增量 + fallback）

```typescript
async function generateSummaryWithFallback(
  messages: UIMessage[],
  model: LanguageModelV3,
  fallbackModels: LanguageModelV3[] | undefined,
  conversationId: string,
  dataStore: DataStore,
  config: ContextWindowConfig,
): Promise<string> {
  // 1. 构建摘要输入
  const stripped = stripImagesFromMessages(messages);
  const conversationText = stripped.map(m => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    return `${role}: ${extractMessageText(m)}`;
  }).join('\n\n');

  // 2. 增量摘要：如果 DB 有已存摘要，在其基础上追加
  let prompt: string;
  if (config.incrementalSummary) {
    const existing = dataStore.summaryStore.getSummaryByConversation(conversationId);
    if (existing?.summary) {
      prompt = `【历史摘要】\n${existing.summary}\n\n【新增对话】\n${conversationText}`;
    } else {
      prompt = conversationText;
    }
  } else {
    prompt = conversationText;
  }

  // 3. 调用 LLM 生成摘要（主模型 + fallback）
  const summary = await callWithFallback(prompt, model, fallbackModels);

  // 4. 质量验证
  if (summary && validateSummaryQuality(summary, messages)) {
    // 持久化到 DB
    dataStore.summaryStore.saveSummary({
      conversationId,
      summary,
      compactedAt: new Date().toISOString(),
      lastMessageOrder: messages.length - 1,
      lastMessageId: messages[messages.length - 1]?.id,
      preCompactTokenCount: 0,
    });
    return summary;
  }

  // 5. LLM 失败 → 模板 fallback
  return generateTemplateSummary(messages);
}

async function callWithFallback(
  prompt: string,
  model: LanguageModelV3,
  fallbackModels?: LanguageModelV3[],
): Promise<string | null> {
  // 主模型尝试 2 次
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await generateText({
        model,
        system: SUMMARY_SYSTEM_PROMPT,
        prompt,
        maxTokens: 2000,
      });
      if (text?.trim()) return text.trim();
    } catch (err) {
      console.warn(`[ContextWindow] Summary attempt ${attempt + 1} failed:`, err);
      if (attempt === 0) await delay(2000);
    }
  }
  // fallback 模型各 1 次
  for (const fb of fallbackModels ?? []) {
    try {
      const { text } = await generateText({
        model: fb,
        system: SUMMARY_SYSTEM_PROMPT,
        prompt,
        maxTokens: 2000,
      });
      if (text?.trim()) return text.trim();
    } catch {}
  }
  return null;
}
```

### 6.3 质量验证和模板 fallback

直接复用 V1 的 `validateSummaryQuality` 和 `generateFallbackSummary`。它们已经足够健壮（支持中英文关键词检测、压缩率检查、模板拼接降级）。

---

## 7. 首次加载预算检查 (initial-budget-check.ts)

历史对话恢复时，消息可能已经很长。在 `createChatAgent` 中一次性处理。

```typescript
export async function checkInitialBudget(
  messages: UIMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string,
  config: CompactionConfig,
  context: {
    dataStore: DataStore;
    conversationId: string;
    model?: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
  },
): Promise<{
  passed: boolean;
  estimation: FullRequestEstimation;
  actions: string[];
  adjustedMessages?: UIMessage[];
  adjustedTools?: Record<string, Tool>;
}> {
  const estimation = await estimateFullRequest(messages, instructions, tools, modelName);
  const actions: string[] = [];

  if (!estimation.exceedsLimit) {
    return { passed: true, estimation, actions: ['Budget check passed'] };
  }

  let currentMessages = messages;
  let currentTools = tools;
  let currentEstimation = estimation;

  // ── Strategy 1: Layer 2 压缩旧工具输出 ──
  // 与 prepareStep 中调用的是同一个函数，但 keepRecentTurns 更激进
  const aggressiveConfig = { ...config.lifecycle, keepRecentTurns: 1 };
  const lifecycleResult = manageToolOutputLifecycle(currentMessages, aggressiveConfig);
  if (lifecycleResult.tokensFreed > 0) {
    currentMessages = lifecycleResult.messages;
    actions.push(`Layer 2: freed ${lifecycleResult.tokensFreed} tokens`);
    currentEstimation = await reestimate(currentEstimation, currentMessages, modelName);
    if (!currentEstimation.exceedsLimit) {
      return { passed: true, estimation: currentEstimation, actions, adjustedMessages: currentMessages };
    }
  }

  // ── Strategy 2: 工具过滤（保留 V1 逻辑） ──
  if (currentEstimation.toolsTokens > currentEstimation.modelLimit * 0.10) {
    const filtered = filterToolsByPriority(currentTools, currentEstimation);
    const removed = Object.keys(currentTools).length - Object.keys(filtered).length;
    if (removed > 0) {
      currentTools = filtered;
      actions.push(`Tool filter: removed ${removed} tools`);
      currentEstimation = await reestimate(currentEstimation, currentMessages, modelName, currentTools);
      if (!currentEstimation.exceedsLimit) {
        return { passed: true, estimation: currentEstimation, actions,
          adjustedMessages: currentMessages, adjustedTools: currentTools };
      }
    }
  }

  // ── Strategy 3: Layer 3 LLM 摘要 ──
  if (context.conversationId && context.model) {
    const policy = buildPromptBudgetPolicy({ modelName });
    const windowResult = await enforceContextWindow(currentMessages, {
      model: context.model,
      fallbackModels: context.fallbackModels,
      modelName,
      policy,
      fixedOverhead: {
        instructionsTokens: currentEstimation.instructionsTokens,
        toolsTokens: currentEstimation.toolsTokens,
      },
      conversationId: context.conversationId,
      dataStore: context.dataStore,
      config: config.contextWindow,
    });
    if (windowResult.executed) {
      currentMessages = windowResult.messages;
      actions.push(`Layer 3: freed ${windowResult.tokensFreed} tokens`);
      currentEstimation = await reestimate(currentEstimation, currentMessages, modelName);
      if (!currentEstimation.exceedsLimit) {
        return { passed: true, estimation: currentEstimation, actions,
          adjustedMessages: currentMessages, adjustedTools: currentTools };
      }
    }
  }

  // ── Strategy 4: 紧急截断 ──
  const targetBudget = currentEstimation.modelLimit * 0.50;
  if (currentEstimation.messagesTokens > targetBudget) {
    const truncated = truncateFromHead(currentMessages, targetBudget, modelName);
    currentMessages = truncated.messages;
    actions.push(`Emergency truncate: removed ${truncated.removed} messages`);
  }

  const finalEstimation = await reestimate(currentEstimation, currentMessages, modelName, currentTools);
  return {
    passed: !finalEstimation.exceedsLimit,
    estimation: finalEstimation,
    actions,
    adjustedMessages: currentMessages,
    adjustedTools: currentTools,
  };
}
```

**与 V1 的区别**：Strategy 1 不再是 MicroCompact，而是 Layer 2（工具输出生命周期管理）。同一个函数，只是 `keepRecentTurns=1`（更激进）。Strategy 4 的紧急截断简化了 — 不需要 preserveToolPairs，因为 Layer 2 已经替换了工具输出内容，不需要担心拆对。

**注意**：如果消息中已经被 Layer 2 压缩过（`_compacted: true`），这些消息只包含元信息摘要，截断它们不会造成 tool pair 问题。

### 紧急截断（简化版）

```typescript
function truncateFromHead(
  messages: UIMessage[],
  targetMessageTokens: number,
  modelName: string,
): { messages: UIMessage[]; removed: number } {
  let tokens = estimateMessagesTokensSync(messages);
  let startIndex = 0;

  // 从头部移除消息，保留至少 3 条
  while (tokens > targetMessageTokens && startIndex < messages.length - 3) {
    tokens -= estimateMessageTokensSync(messages[startIndex]);
    startIndex++;
  }

  // 不需要 preserveToolPairs：
  // - 旧工具输出已被 Layer 2 替换为元信息
  // - 元信息是 { summary, _compacted: true }，不是 tool_use/tool_result 对
  // - 截断 _compacted 消息不会造成 API 报错
  //
  // 但如果截到了最近 1 轮（Layer 2 keepRecentTurns=1 保留的），
  // 那里可能还有未压缩的 tool pair。此时应跳到下一个用户消息边界。
  while (startIndex < messages.length - 3) {
    const msg = messages[startIndex];
    if (msg.role === 'user') break; // 用户消息是安全的截断点
    startIndex++;
  }

  return {
    messages: messages.slice(startIndex),
    removed: startIndex,
  };
}
```

---

## 8. 响应式重试 (reactive-retry.ts)

保留 V1 的 `isContextLengthError`、`extractServerTokensFromError`、`ContextLengthDiagnosticError`（它们是纯错误检测工具，不需要修改）。

新增实际重试逻辑：

```typescript
export async function handleReactiveRetry(
  error: unknown,
  messages: UIMessage[],
  config: CompactionConfig,
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    policy: PromptBudgetPolicy;
    fixedOverhead: { instructionsTokens: number; toolsTokens: number };
    conversationId: string;
    dataStore: DataStore;
  },
): Promise<{ messages: UIMessage[] }> {
  if (!isContextLengthError(error)) throw error;

  console.warn('[ReactiveRetry] Context length error detected, attempting recovery');

  // 1. 激进 Layer 2：keepRecentTurns=1
  let current = manageToolOutputLifecycle(messages, {
    ...config.lifecycle,
    keepRecentTurns: 1,
  }).messages;

  // 检查是否足够
  const est1 = await estimateRequestBudgetWithFixedOverhead({
    messages: current,
    ...context.fixedOverhead,
    modelName: context.modelName,
    policy: context.policy,
  });
  if (est1.totalTokens < context.policy.triggerTokens) {
    return { messages: current };
  }

  // 2. Layer 3 紧急摘要
  const windowResult = await enforceContextWindow(current, {
    ...context,
    config: { ...config.contextWindow, targetPercent: 0.50 }, // 更激进的目标
  });
  current = windowResult.messages;

  return { messages: current };
}
```

---

## 9. 入口：compactBeforeStep (index.ts)

在 `prepareStep` 中调用的统一入口。

```typescript
/**
 * prepareStep 中调用：每步 API 调用前的上下文管理
 *
 * 执行顺序：
 * 1. 应用 Agent 主动释放的工具输出 (Layer 1)
 * 2. 工具输出生命周期管理 (Layer 2) — 同步、微秒级
 * 3. 上下文窗口检查 (Layer 3) — 极少触发
 */
export async function compactBeforeStep(
  messages: UIMessage[],
  sessionState: SessionState,
  config: CompactionConfig,
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    policy: PromptBudgetPolicy;
    fixedOverhead: { instructionsTokens: number; toolsTokens: number };
    conversationId: string;
    dataStore: DataStore;
  },
): Promise<UIMessage[]> {
  let current = messages;

  // Layer 1: 应用 Agent 主动释放
  if (sessionState.pendingCompactIds.length > 0) {
    current = applyPendingCompactions(current, sessionState.pendingCompactIds);
    sessionState.pendingCompactIds = [];
  }

  // Layer 2: 工具输出生命周期管理（同步，微秒级）
  const lifecycle = manageToolOutputLifecycle(current, config.lifecycle);
  current = lifecycle.messages;

  // Layer 3: 上下文窗口检查（异步，极少触发）
  const estimation = await estimateRequestBudgetWithFixedOverhead({
    messages: current,
    ...context.fixedOverhead,
    modelName: context.modelName,
    policy: context.policy,
  });

  const triggerTokens = Math.floor(context.policy.contextLimit * config.contextWindow.triggerPercent);
  if (estimation.totalTokens >= triggerTokens) {
    const windowResult = await enforceContextWindow(current, {
      ...context,
      config: config.contextWindow,
    });
    if (windowResult.executed) {
      current = windowResult.messages;
    }
  }

  return current;
}

function applyPendingCompactions(messages: UIMessage[], ids: string[]): UIMessage[] {
  const idSet = new Set(ids);
  return messages.map(msg => {
    if (!hasToolInvocationParts(msg)) return msg;
    const newParts = msg.parts.map(p => {
      if (p.type !== 'tool-invocation') return p;
      if (!idSet.has(p.toolCallId)) return p;
      if (p.result?._compacted) return p;
      const summary = extractToolMeta(p.toolName, p.args, p.result);
      const originalSize = JSON.stringify(p.result).length;
      return { ...p, result: { summary, _compacted: true, _originalSize: originalSize } };
    });
    return { ...msg, parts: newParts };
  });
}
```

---

## 10. Layer 1: Agent 主动释放工具（可选）

作为优化层，不是依赖。在 `loadAllTools` 中注册：

```typescript
const compactToolResultTool = tool({
  description: 'Release tool outputs you no longer need to free context space. ' +
    'Call this after you have extracted all needed information from a tool result.',
  parameters: z.object({
    toolCallIds: z.array(z.string()).describe('IDs of tool calls to compact'),
  }),
  execute: async ({ toolCallIds }) => {
    sessionState.pendingCompactIds.push(...toolCallIds);
    return { compacted: toolCallIds.length, message: 'Will be applied before next step' };
  },
});
```

System prompt 中加一句简短指令（不要写长 — Agent 倾向忽略长的维护性指令）：

```
When you finish using a tool's output, call compact_tool_result to free context space.
```

---

## 11. 集成到现有代码

### create.ts 中的调用

```typescript
// 在 createChatAgent 中，替换原来的 checkInitialBudget 调用：
const budgetCheck = await checkInitialBudget(
  messagesWithAttachments,
  instructions,
  tools,
  modelName,
  compactionConfig,    // CompactionConfig V2
  {
    dataStore,
    conversationId,
    model: sessionState.compactModel,
    fallbackModels: sessionState.fallbackModels,
  },
);
```

### agent-control pipeline 中的调用

```typescript
// 在 createAgentPipeline 的 prepareStep 中：
const prepareStep = async ({ messages, steps }) => {
  // ... 现有逻辑（成本检查、step 计数等）...

  // V2 上下文管理（替换原来的 compactMessagesIfNeeded 调用）
  const compacted = await compactBeforeStep(messages, sessionState, compactionConfig, {
    model: sessionState.compactModel,
    fallbackModels: sessionState.fallbackModels,
    modelName,
    policy,
    fixedOverhead: sessionState.fixedOverhead,
    conversationId,
    dataStore,
  });

  return { messages: compacted, tools, instructions };
};
```

### route.ts 中的调用

```typescript
// postTaskCleanup 中：不再需要 runCompactInBackground
// Layer 2 在每步 prepareStep 中已经管理了工具输出
// Layer 3 在 prepareStep 中检查并执行
// 删除 runCompactInBackground 调用
```

---

## 12. 对比总结

| 维度 | V1 | V2 |
|------|-----|-----|
| 文件数 | 14 | 6（+ 4 复用 V1） |
| 新增代码 | ~3000 行 | ~800 行 |
| pipeline 步骤 | 6 步 | 0（Layer 2 在每步自动执行） |
| LLM 调用（热路径） | 每次压缩 1-4 次 | 0（Layer 2 不调 LLM） |
| LLM 调用（冷路径） | 同上 | 极少（Layer 3 仅在纯文本对话超限时） |
| preserveToolPairs | 3 处重复实现 | 不需要 |
| 状态机 | 5 种状态 + 熔断器 | 无 |
| 后台队列 | 有 | 无 |
| 信息恢复 | 无 | 元信息保留 |
| 历史对话恢复 | 有 | 有（简化版） |
| API 错误兜底 | 有 | 有 |
| 非工具对话处理 | 有（API compact） | 有（Layer 3） |
| MCP 工具处理 | 有 | 有（通用提取器） |
| 增量摘要 | 有 | 有 |
| DB 持久化 | 有 | 有 |

---

## 13. 迁移策略

### Phase 1: Layer 2 并行运行

在 V1 的 `prepareStep` 中加入 `manageToolOutputLifecycle`，在现有 pipeline 之前执行。两者并行。

监控 Layer 2 的 `tokensFreed` 和 V1 pipeline 的触发频率。预期：Layer 2 生效后 pipeline 触发频率下降 80%+。

### Phase 2: 替换 pipeline

如果数据确认 pipeline 触发频率大幅下降：
- 用 `compactBeforeStep` 替换 `compactMessagesIfNeeded`
- 用简化版 `checkInitialBudget` 替换原版
- 删除 micro-compact、session-memory、api-compact、ptl-degradation、auto-compact、background-queue、boundary、tool-pair-utils

### Phase 3: 加入 Layer 1

加入 `compact_tool_result` 工具，观察 Agent 使用频率和效果。

---

## 14. 风险与缓解

| 风险 | 严重性 | 缓解 |
|------|--------|------|
| 元信息不够，Agent 需要重新读取 | 低 | Agent 自然会重新调工具；通用提取器保留了结构轮廓 |
| keepRecentTurns=3 不适合长工具链 | 中 | 可配置；技能可覆盖；largeOutputThreshold 处理单步大输出 |
| MCP 工具输出的通用提取不理想 | 中 | 通用提取器保留首尾+结构；逐步添加特定提取器 |
| Layer 3 摘要质量 | 低 | 触发频率比 V1 低一个数量级；有质量验证+模板 fallback |
| 紧急截断没有 preserveToolPairs | 低 | 截断点对齐用户消息边界；Layer 2 已压缩旧工具输出 |
