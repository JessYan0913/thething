# 上下文预算管理与大输出工具处理设计方案

> 基于 ClaudeCode 架构调研与项目现状分析（2026-04-21）

## 文档信息

- **创建日期**: 2026-04-21
- **背景**: 解决 `Range of input length should be [1, 258048]` 错误
- **参考来源**:
  - ClaudeCode Architecture 文档（`ccb.agent-aura.top`）
  - 项目现有代码审计

---

## 1. 问题诊断

### 1.1 当前错误根因

```
Range of input length should be [1, 258048]
```

**根本原因**：第一次 API 调用时，请求总量超出模型上下文限制：

| 组成部分 | Token 估算 | 当前处理 |
|---------|-----------|---------|
| 系统提示词 (instructions) | ~15-25K | ❌ 未计入预算 |
| 工具定义 (tools JSON Schema) | ~10-20K (15 tools) | ❌ 未计入预算 |
| 消息历史 (messages) | 动态 | ✅ 已计入 |
| 输出预留 | ~8K | ❌ 固定 128K 未考虑 |

**预算模型错误**：
```typescript
// 当前实现 (token-budget.ts)
maxContextTokens: number = 128_000  // 硬编码，未按模型动态设置
compactThreshold: number = 25_000   // 只考虑消息累积
```

### 1.2 ClaudeCode 的预算模型

```
上下文窗口 = getModelContextWindowForModel()
有效上下文 = 窗口大小 - maxOutputTokens - 系统提示词 - 工具定义
自动压缩触发点 = 有效上下文 - AUTOCOMPACT_BUFFER_TOKENS (13K)
```

**关键差异**：
- ClaudeCode 在第一次调用**前**就计算完整预算
- 系统提示词 + 工具定义**被计入固定开销**
- 模型上下文限制**动态获取**（而非硬编码）

---

## 2. 项目现状盘点

### 2.1 已具备的能力

| 能力 | 实现位置 | 状态 |
|-----|---------|------|
| **MicroCompact** | `micro-compact.ts` | ✅ 时间触发 + 大小触发 |
| **Session Memory Compact** | `session-memory-compact.ts` | ✅ DB 摘要压缩 |
| **API Compact** | `api-compact.ts` | ✅ LLM 压缩 |
| **PTL Degradation** | `ptl-degradation.ts` | ✅ 紧急硬截断 |
| **工具输出截断** | 各工具文件 | ⚠️ 部分实现（bash/read 有） |
| **Post Compact Reinject** | `post-compact-reinject.ts` | ✅ 50K 预算恢复 |
| **压缩断路器** | `auto-compact.ts` | ✅ 3 连失败 trip |
| **Token 估算** | `token-counter.ts` | ⚠️ 仅消息，无工具/指令估算 |

### 2.2 缺失的关键能力

| 能力 | 影响 | 优先级 |
|-----|------|-------|
| **模型上下文限制动态获取** | 高 - 硬编码导致误判 | P0 |
| **工具定义 Token 估算** | 高 - 未计入初始预算 | P0 |
| **系统提示词 Token 估算** | 高 - 未计入初始预算 | P0 |
| **初始预算检查** | 高 - 第一次调用前无保护 | P0 |
| **统一工具输出截断配置** | 中 - 各工具分散定义 | P1 |

---

## 3. 设计方案

### 3.1 模型上下文限制配置

**新增文件**: `packages/core/src/model-capabilities.ts`

```typescript
/**
 * 模型能力元数据
 * 参考 ClaudeCode getContextWindowForModel()
 */
export interface ModelCapabilities {
  /** 上下文窗口限制（tokens） */
  contextLimit: number;
  /** 默认输出预留（tokens） */
  defaultOutputTokens: number;
  /** 最大输出限制（tokens） */
  maxOutputTokens: number;
  /** 是否支持 Prompt Cache */
  supportsPromptCache: boolean;
  /** 是否支持 Thinking Mode */
  supportsThinking: boolean;
}

/**
 * 模型能力配置表
 * 来源：各模型官方文档 + 实测
 */
export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // Qwen 系列（DashScope）
  'qwen-max': {
    contextLimit: 1_000_000,
    defaultOutputTokens: 8_000,
    maxOutputTokens: 64_000,
    supportsPromptCache: false,
    supportsThinking: true,
  },
  'qwen-plus': {
    contextLimit: 128_000,
    defaultOutputTokens: 8_000,
    maxOutputTokens: 32_000,
    supportsPromptCache: false,
    supportsThinking: false,
  },
  'qwen-turbo': {
    contextLimit: 128_000,
    defaultOutputTokens: 8_000,
    maxOutputTokens: 16_000,
    supportsPromptCache: false,
    supportsThinking: false,
  },
  'qwen3.5-27b': {
    contextLimit: 258_048,  // 实测值
    defaultOutputTokens: 8_000,
    maxOutputTokens: 16_000,
    supportsPromptCache: false,
    supportsThinking: false,
  },
  // 默认值（保守估计）
  'default': {
    contextLimit: 128_000,
    defaultOutputTokens: 8_000,
    maxOutputTokens: 16_000,
    supportsPromptCache: false,
    supportsThinking: false,
  },
};

/**
 * 获取模型上下文限制
 * 参考 ClaudeCode 5 级优先级解析
 */
export function getModelCapabilities(modelName: string): ModelCapabilities {
  // 1. 精确匹配
  if (MODEL_CAPABILITIES[modelName]) {
    return MODEL_CAPABILITIES[modelName];
  }
  
  // 2. 模型名后缀解析（如 "qwen-max[1m]" 表示 1M）
  if (modelName.includes('[1m]')) {
    return { ...MODEL_CAPABILITIES['default'], contextLimit: 1_000_000 };
  }
  
  // 3. 前缀匹配（如 "qwen-*" 系列）
  for (const [key, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (modelName.startsWith(key) || key.startsWith(modelName.split('-')[0])) {
      return caps;
    }
  }
  
  // 4. 兜底：默认值
  return MODEL_CAPABILITIES['default'];
}

/**
 * 计算有效上下文预算
 * 有效上下文 = 窗口 - 输出预留
 */
export function getEffectiveContextBudget(modelName: string): number {
  const caps = getModelCapabilities(modelName);
  return caps.contextLimit - caps.defaultOutputTokens;
}
```

### 3.2 Token 估算扩展

**扩展文件**: `packages/core/src/compaction/token-counter.ts`

```typescript
import type { Tool } from 'ai';

const CHARS_PER_TOKEN_AVG = 3.5;
const TOOL_SCHEMA_OVERHEAD = 50;  // 每个工具的固定开销（name + description）

/**
 * 估算工具定义的 Token 数量
 * 参考 ClaudeCode: tool_use 序列化 name + JSON.stringify(input) 后 / 4
 */
export function estimateToolTokens(tool: Tool): number {
  // 1. 工具名称
  const nameTokens = 4;  // 工具名通常很短
  
  // 2. 工具描述
  const descTokens = estimateTextTokens(tool.description || '');
  
  // 3. Input Schema (JSON Schema → JSON string → tokens)
  let schemaTokens = TOOL_SCHEMA_OVERHEAD;
  try {
    // Zod schema 或 JSON Schema
    const schema = tool.inputSchema;
    if (schema) {
      const schemaJson = JSON.stringify(schema);
      schemaTokens = Math.ceil(schemaJson.length / 4);  // JSON 密集格式
    }
  } catch {
    schemaTokens = 200;  // 估算失败时的保守值
  }
  
  return nameTokens + descTokens + schemaTokens;
}

/**
 * 估算所有工具的 Token 数量
 */
export function estimateToolsTokens(tools: Record<string, Tool>): number {
  let total = 0;
  for (const [toolName, tool] of Object.entries(tools)) {
    total += estimateToolTokens(tool);
  }
  
  // 加上 tool_choice 和 tools 数组的 JSON 结构开销
  const arrayOverhead = Math.ceil(JSON.stringify(Object.keys(tools)).length / 4);
  return total + arrayOverhead + 20;  // 20 = tool_choice: auto 的开销
}

/**
 * 估算系统提示词的 Token 数量
 */
export function estimateInstructionsTokens(instructions: string): number {
  return estimateTextTokens(instructions);
}

/**
 * 估算完整请求的 Token 数量
 * 这是最关键的函数，用于初始预算检查
 */
export interface FullRequestEstimation {
  totalTokens: number;
  messagesTokens: number;
  instructionsTokens: number;
  toolsTokens: number;
  outputReserve: number;
  availableBudget: number;
  modelLimit: number;
  exceedsLimit: boolean;
  utilizationPercent: number;
}

export function estimateFullRequest(
  messages: UIMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string
): FullRequestEstimation {
  const caps = getModelCapabilities(modelName);
  
  const messagesTokens = estimateMessagesTokens(messages);
  const instructionsTokens = estimateInstructionsTokens(instructions);
  const toolsTokens = estimateToolsTokens(tools);
  const outputReserve = caps.defaultOutputTokens;
  
  const totalTokens = messagesTokens + instructionsTokens + toolsTokens + outputReserve;
  const modelLimit = caps.contextLimit;
  const availableBudget = modelLimit - totalTokens;
  const exceedsLimit = totalTokens > modelLimit;
  const utilizationPercent = (totalTokens / modelLimit) * 100;
  
  return {
    totalTokens,
    messagesTokens,
    instructionsTokens,
    toolsTokens,
    outputReserve,
    availableBudget,
    modelLimit,
    exceedsLimit,
    utilizationPercent,
  };
}
```

### 3.3 初始预算检查与处理

**新增文件**: `packages/core/src/compaction/initial-budget-check.ts`

```typescript
import type { UIMessage, Tool } from 'ai';
import { estimateFullRequest, getEffectiveContextBudget } from './token-counter';
import { microCompactMessages } from './micro-compact';
import { compactMessagesIfNeeded } from './index';

export interface InitialBudgetCheckResult {
  passed: boolean;
  estimation: FullRequestEstimation;
  actions: string[];
  adjustedTools?: Record<string, Tool>;
  adjustedMessages?: UIMessage[];
}

/**
 * 核心工具白名单（不可移除）
 * 参考 ClaudeCode 的工具重要性分级
 */
const CORE_TOOLS = new Set([
  'bash',
  'read_file',
  'write_file',
  'edit_file',
  'grep',
  'glob',
]);

/**
 * 可选工具优先级（按重要性降序）
 * 超出预算时按此顺序移除
 */
const OPTIONAL_TOOL_PRIORITY = [
  'mcp_*',          // MCP 工具（最先移除）
  'web_search',     // 网络搜索
  'research',       // 研究代理
  'task_*',         // 任务工具
  'connector_*',    // Connector 工具
  'ask_user_question',  // 用户提问
];

/**
 * 初始预算检查
 * 在第一次 API 调用前执行
 */
export async function checkInitialBudget(
  messages: UIMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string
): Promise<InitialBudgetCheckResult> {
  const estimation = estimateFullRequest(messages, instructions, tools, modelName);
  const actions: string[] = [];
  
  if (!estimation.exceedsLimit) {
    return {
      passed: true,
      estimation,
      actions: ['Budget check passed'],
    };
  }
  
  console.warn(
    `[Initial Budget] Estimated ${estimation.totalTokens} tokens exceeds limit ${estimation.modelLimit} ` +
    `(utilization: ${estimation.utilizationPercent.toFixed(1)}%)`
  );
  
  // 超出预算，执行降级策略
  let adjustedMessages = messages;
  let adjustedTools = tools;
  
  // 策略 1: 微压缩（清除旧工具输出）
  if (estimation.messagesTokens > estimation.modelLimit * 0.3) {
    const microResult = microCompactMessages(messages);
    if (microResult.executed && microResult.tokensFreed > 1000) {
      adjustedMessages = microResult.messages;
      actions.push(`MicroCompact: freed ${microResult.tokensFreed} tokens`);
      
      // 重新估算
      const newEst = estimateFullRequest(adjustedMessages, instructions, adjustedTools, modelName);
      if (!newEst.exceedsLimit) {
        return {
          passed: true,
          estimation: newEst,
          actions,
          adjustedMessages,
        };
      }
    }
  }
  
  // 策略 2: 工具过滤（移除低优先级工具）
  if (estimation.toolsTokens > estimation.modelLimit * 0.1) {
    const filteredTools = filterToolsByPriority(tools, estimation);
    if (Object.keys(filteredTools).length < Object.keys(tools).length) {
      adjustedTools = filteredTools;
      const removedCount = Object.keys(tools).length - Object.keys(filteredTools).length;
      actions.push(`Tool filtering: removed ${removedCount} optional tools`);
      
      const newEst = estimateFullRequest(adjustedMessages, instructions, adjustedTools, modelName);
      if (!newEst.exceedsLimit) {
        return {
          passed: true,
          estimation: newEst,
          actions,
          adjustedTools,
          adjustedMessages,
        };
      }
    }
  }
  
  // 策略 3: 消息压缩（LLM 压缩）
  if (estimation.messagesTokens > estimation.modelLimit * 0.2) {
    const compactResult = await compactMessagesIfNeeded(adjustedMessages, 'initial-check');
    if (compactResult.executed) {
      adjustedMessages = compactResult.messages;
      actions.push(`API Compact: freed ${compactResult.tokensFreed} tokens`);
      
      const newEst = estimateFullRequest(adjustedMessages, instructions, adjustedTools, modelName);
      if (!newEst.exceedsLimit) {
        return {
          passed: true,
          estimation: newEst,
          actions,
          adjustedTools,
          adjustedMessages,
        };
      }
    }
  }
  
  // 策略 4: 紧急截断（PTL Degradation）
  // 最后手段，直接丢弃最早的消息
  const targetBudget = getEffectiveContextBudget(modelName) - estimation.instructionsTokens - estimation.toolsTokens;
  const truncateResult = truncateMessagesToBudget(adjustedMessages, targetBudget);
  adjustedMessages = truncateResult.messages;
  actions.push(`Emergency truncate: removed ${truncateResult.messagesRemoved} messages`);
  
  const finalEst = estimateFullRequest(adjustedMessages, instructions, adjustedTools, modelName);
  
  return {
    passed: !finalEst.exceedsLimit,
    estimation: finalEst,
    actions,
    adjustedTools,
    adjustedMessages,
  };
}

/**
 * 按优先级过滤工具
 */
function filterToolsByPriority(
  tools: Record<string, Tool>,
  estimation: FullRequestEstimation
): Record<string, Tool> {
  const result: Record<string, Tool> = {};
  const targetToolTokens = estimation.modelLimit * 0.08;  // 工具预算限制
  
  // 1. 先保留核心工具
  for (const [name, tool] of Object.entries(tools)) {
    if (CORE_TOOLS.has(name)) {
      result[name] = tool;
    }
  }
  
  let currentTokens = estimateToolsTokens(result);
  
  // 2. 按优先级添加可选工具（直到达到预算）
  for (const pattern of OPTIONAL_TOOL_PRIORITY) {
    for (const [name, tool] of Object.entries(tools)) {
      if (result[name]) continue;  // 已添加
      if (CORE_TOOLS.has(name)) continue;  // 核心工具已处理
      
      // 匹配模式
      const matches = pattern.endsWith('*') 
        ? name.startsWith(pattern.slice(0, -1))
        : name === pattern;
      
      if (matches) {
        const toolTokens = estimateToolTokens(tool);
        if (currentTokens + toolTokens < targetToolTokens) {
          result[name] = tool;
          currentTokens += toolTokens;
        }
      }
    }
  }
  
  return result;
}

/**
 * 紧急截断消息到预算
 */
function truncateMessagesToBudget(
  messages: UIMessage[],
  targetBudget: number
): { messages: UIMessage[]; messagesRemoved: number } {
  // 从最旧的消息开始移除
  let currentTokens = estimateMessagesTokens(messages);
  let startIndex = 0;
  
  while (currentTokens > targetBudget && startIndex < messages.length - 3) {
    const removedTokens = estimateMessageTokens(messages[startIndex]);
    currentTokens -= removedTokens;
    startIndex++;
  }
  
  const truncated = messages.slice(startIndex);
  return {
    messages: truncated,
    messagesRemoved: startIndex,
  };
}
```

### 3.4 集成到 Agent 创建流程

**修改文件**: `packages/core/src/agent/create.ts`

```typescript
import { checkInitialBudget } from '../compaction/initial-budget-check';

export async function createChatAgent(config: CreateAgentConfig): Promise<CreateAgentResult> {
  // ... 现有代码直到加载工具 ...
  
  const { tools, mcpRegistry } = await loadAllTools({...});
  
  // ✅ 新增：初始预算检查
  const budgetCheck = await checkInitialBudget(
    messages,
    instructions,
    tools,
    modelConfig.modelName
  );
  
  if (!budgetCheck.passed) {
    console.error(
      `[Agent Create] Budget check failed after all strategies: ` +
      `${budgetCheck.estimation.totalTokens} / ${budgetCheck.estimation.modelLimit}`
    );
    // 使用调整后的结果继续（即使超出，让 API 返回错误以便触发恢复链）
  }
  
  if (budgetCheck.actions.length > 0) {
    console.log(`[Agent Create] Budget actions: ${budgetCheck.actions.join(', ')}`);
  }
  
  // 使用调整后的消息和工具
  const finalMessages = budgetCheck.adjustedMessages ?? messages;
  const finalTools = budgetCheck.adjustedTools ?? tools;
  
  // ... 继续创建 agent ...
  
  const agent = new ToolLoopAgent({
    model: wrappedModel,
    instructions,
    tools: finalTools,  // 使用可能被过滤的工具
    prepareStep,
    stopWhen,
    toolChoice: 'auto',
  });
  
  return {
    agent,
    sessionState,
    mcpRegistry,
    tools: finalTools,
    instructions,
  };
}
```

### 3.5 统一工具输出截断配置

**新增文件**: `packages/core/src/tools/output-limits.ts`

```typescript
/**
 * 工具输出限制配置
 * 参考 ClaudeCode maxResultSizeChars（通常 100K）
 */

/** 默认最大输出字符数 */
export const DEFAULT_MAX_OUTPUT_CHARS = 50_000;

/** 默认最大输出 Token 数（保守估计） */
export const DEFAULT_MAX_OUTPUT_TOKENS = 15_000;  // 50K chars / 3.5 ≈ 14K

/** 工具输出限制配置表 */
export const TOOL_OUTPUT_LIMITS: Record<string, {
  maxChars: number;
  maxTokens: number;
  truncationMessage: string;
}> = {
  'bash': {
    maxChars: 50_000,
    maxTokens: 15_000,
    truncationMessage: '\n\n... (输出被截断，超过限制) ...',
  },
  'read_file': {
    maxChars: 50_000,
    maxTokens: 15_000,
    truncationMessage: '\n\n... (文件内容被截断) ...',
  },
  'grep': {
    maxChars: 30_000,  // grep 结果通常不需要太长
    maxTokens: 9_000,
    truncationMessage: '\n\n... (搜索结果被截断，请缩小范围) ...',
  },
  'web_search': {
    maxChars: 20_000,
    maxTokens: 6_000,
    truncationMessage: '\n\n... (搜索结果被截断) ...',
  },
  'connector_sql': {
    maxChars: 50_000,
    maxTokens: 15_000,
    truncationMessage: '\n\n... (SQL 结果被截断) ...',
  },
  // 默认配置
  'default': {
    maxChars: DEFAULT_MAX_OUTPUT_CHARS,
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    truncationMessage: '\n\n... (结果被截断) ...',
  },
};

/**
 * 获取工具输出限制
 */
export function getToolOutputLimit(toolName: string) {
  // 精确匹配
  if (TOOL_OUTPUT_LIMITS[toolName]) {
    return TOOL_OUTPUT_LIMITS[toolName];
  }
  
  // 前缀匹配（如 mcp_*, connector_*）
  for (const [key, limits] of Object.entries(TOOL_OUTPUT_LIMITS)) {
    if (toolName.startsWith(key) || key === 'default') {
      return limits;
    }
  }
  
  return TOOL_OUTPUT_LIMITS['default'];
}

/**
 * 截断输出到限制
 */
export function truncateToolOutput(
  output: string,
  toolName: string
): { content: string; truncated: boolean } {
  const limits = getToolOutputLimit(toolName);
  
  if (output.length <= limits.maxChars) {
    return { content: output, truncated: false };
  }
  
  const truncated = output.slice(0, limits.maxChars) + limits.truncationMessage;
  return { content: truncated, truncated: true };
}
```

### 3.6 增强压缩配置

**更新文件**: `packages/core/src/compaction/types.ts`

```typescript
import type { Tool } from 'ai';

/**
 * 更新压缩阈值配置
 */
export const COMPACT_TOKEN_THRESHOLD = 25_000;

/**
 * MicroCompact 配置更新
 */
export const DEFAULT_MICRO_COMPACT_CONFIG: MicroCompactConfig = {
  timeWindowMs: 15 * 60 * 1000,
  imageMaxTokenSize: 2000,  // 图片/大输出工具的阈值
  compactableTools: new Set([
    // 核心工具
    'bash',
    'read_file',
    'write_file',
    'edit_file',
    'grep',
    'glob',
    // 网络工具
    'web_search',
    // MCP 和 Connector 工具（动态）
    // 通过 isCompactableTool() 检查
  ]),
  gapThresholdMinutes: 60,
  keepRecent: 5,
};

/**
 * 判断工具是否可压缩
 * 扩展支持 MCP 和 Connector 工具
 */
export function isCompactableTool(toolName: string): boolean {
  // 精确匹配
  if (DEFAULT_MICRO_COMPACT_CONFIG.compactableTools.has(toolName)) {
    return true;
  }
  
  // 前缀匹配：MCP 工具
  if (toolName.startsWith('mcp_')) {
    return true;
  }
  
  // 前缀匹配：Connector 工具
  if (toolName.startsWith('connector_')) {
    return true;
  }
  
  return false;
}

/**
 * Post Compact 重新注入配置
 * 参考 ClaudeCode POST_COMPACT_TOKEN_BUDGET = 50K
 */
export const DEFAULT_POST_COMPACT_CONFIG: PostCompactConfig = {
  totalBudget: 50_000,
  maxFilesToRestore: 5,
  maxTokensPerFile: 5_000,
  maxTokensPerSkill: 5_000,
  skillsTokenBudget: 25_000,
};
```

---

## 4. 数据流设计

### 4.1 初始调用流程

```
createChatAgent(config)
  │
  ├─► buildSystemPrompt() → instructions (~15-25K tokens)
  │
  ├─► loadAllTools() → tools (~10-20K tokens)
  │
  ├─► ✅ NEW: checkInitialBudget(messages, instructions, tools, modelName)
  │     │
  │     ├─► estimateFullRequest()
  │     │     └─► total = messages + instructions + tools + outputReserve
  │     │
  │     ├─► if exceedsLimit:
  │     │     ├─► Strategy 1: microCompactMessages()
  │     │     ├─► Strategy 2: filterToolsByPriority()
  │     │     ├─► Strategy 3: compactMessagesIfNeeded()
  │     │     └─► Strategy 4: truncateMessagesToBudget()
  │     │
  │     └─► return { adjustedMessages, adjustedTools, actions }
  │
  ├─► create ToolLoopAgent(finalMessages, finalTools)
  │
  └─► return agent
```

### 4.2 工具执行流程

```
tool.execute(input)
  │
  ├─► 执行工具逻辑
  │
  ├─► ✅ NEW: truncateToolOutput(result, toolName)
  │     └─► maxChars = getToolOutputLimit(toolName)
  │     └─► if exceeds: result = truncated + message
  │
  ├─► return result
  │
  └─► (后续) MicroCompact 检查
       └─► if tool_output > imageMaxTokenSize (2000)
           └─► replace with "[Old tool result content cleared]"
```

### 4.3 压缩触发流程

```
每轮 prepareStep
  │
  ├─► sessionState.tokenBudget.shouldCompact()
  │     └─► total > maxContext - compactThreshold
  │
  ├─► ✅ NEW: 使用动态阈值
  │     effectiveThreshold = getEffectiveContextBudget(modelName) - AUTOCOMPACT_BUFFER
  │
  ├─► if shouldCompact:
  │     ├─► Layer 1: microCompactMessages() (清除旧工具输出)
  │     ├─► Layer 2: trySessionMemoryCompact() (DB 摘要)
  │     ├─► Layer 3: compactViaAPI() (LLM 压缩)
  │     └─► Layer 4: tryPtlDegradation() (紧急截断)
  │
  └─► reinjectAfterCompact() (恢复关键上下文，50K 预算)
```

---

## 5. 实施优先级

| 阶段 | 任务 | 工作量 | 依赖 | 状态 |
|-----|------|-------|------|------|
| **Phase 1** | 模型能力配置 (`model-capabilities.ts`) | 0.5 天 | 无 | ✅ 已完成 |
| **Phase 2** | Token 估算扩展 (`token-counter.ts`) | 1 天 | Phase 1 | ✅ 已完成 |
| **Phase 3** | 初始预算检查 (`initial-budget-check.ts`) | 1.5 天 | Phase 2 | ✅ 已完成 |
| **Phase 4** | Agent 创建集成 | 0.5 天 | Phase 3 | ✅ 已完成 |
| **Phase 5** | 统一输出截断 (`output-limits.ts`) | 0.5 天 | 无 | ✅ 已完成 |
| **Phase 6** | 工具集成使用统一截断 | 0.5 天 | Phase 5 | ✅ 已完成 |
| **Phase 7** | 测试 + 文档 | 1 天 | 全部 | ⏳ 进行中 |

**总计**: 约 5 天

### 5.1 实现详情

**Phase 1-4 已完成**:
- `model-capabilities.ts`: 模型上下文限制配置表已实现
- `token-counter.ts`: 添加了 `estimateToolTokens()`, `estimateToolsTokens()`, `estimateInstructionsTokens()`, `estimateFullRequest()`
- `initial-budget-check.ts`: 四层降级策略已实现（MicroCompact → 工具过滤 → API Compact → 紧急截断）
- `agent/create.ts`: 在第 84 行调用 `checkInitialBudget()`

**Phase 5 已完成**:
- `output-limits.ts`: 文件已创建，包含完整的配置和截断函数
  - `TOOL_OUTPUT_LIMITS`: 各工具的输出限制配置表
  - `getToolOutputLimit()`: 获取工具限制配置（支持精确匹配和前缀匹配）
  - `truncateToolOutput()`: 字符串截断
  - `truncateJsonOutput()`: JSON 输出截断
  - `estimateToolOutputTokens()`: Token 估算
  - `shouldMarkForMicroCompact()`: 判断是否需要 MicroCompact

**Phase 6 已完成**:
- `bash.ts`: 使用 `truncateToolOutput()` 替代手动截断，导入 `DEFAULT_MAX_OUTPUT_CHARS`
- `read.ts`: 使用 `truncateToolOutput()` 处理最终输出，导入 `DEFAULT_MAX_OUTPUT_CHARS`
- `grep.ts`: 使用 `truncateJsonOutput()` 处理 JSON 结果
- `glob.ts`: 使用 `truncateJsonOutput()` 处理文件列表
- `exa-search.ts`: 使用 `truncateJsonOutput()` 处理搜索结果
- `compaction/types.ts`: 可压缩工具列表已配置，`isCompactableTool()` 支持别名匹配和前缀匹配

### 5.2 工具集成对照表

| 工具文件 | 截断函数 | 配置键名 | 状态 |
|---------|---------|---------|------|
| `bash.ts` | `truncateToolOutput()` | `bash` | ✅ |
| `read.ts` | `truncateToolOutput()` | `read_file` | ✅ |
| `grep.ts` | `truncateJsonOutput()` | `grep` | ✅ |
| `glob.ts` | `truncateJsonOutput()` | `glob` | ✅ |
| `exa-search.ts` | `truncateJsonOutput()` | `exa_search` | ✅ |
| `write.ts` | 无需截断（输出小） | `write_file` | ⏭️ 跳过 |
| `edit.ts` | 无需截断（输出小） | `edit_file` | ⏭️ 跳过 |
| `ask-user-question.ts` | 无需截断（输出小） | `ask_user_question` | ⏭️ 跳过 |

---

## 6. 验证方案

### 6.1 单元测试

```typescript
// test/model-capabilities.test.ts
describe('getModelCapabilities', () => {
  it('should return correct limits for qwen3.5-27b', () => {
    const caps = getModelCapabilities('qwen3.5-27b');
    expect(caps.contextLimit).toBe(258_048);
  });
});

// test/token-counter.test.ts
describe('estimateToolsTokens', () => {
  it('should estimate 15 tools at ~15K tokens', () => {
    const tools = createMockTools(15);
    const tokens = estimateToolsTokens(tools);
    expect(tokens).toBeGreaterThan(10_000);
    expect(tokens).toBeLessThan(25_000);
  });
});

// test/initial-budget-check.test.ts
describe('checkInitialBudget', () => {
  it('should pass when under limit', async () => {
    const result = await checkInitialBudget([], 'short', tools, 'qwen-max');
    expect(result.passed).toBe(true);
  });
  
  it('should filter tools when over limit', async () => {
    const result = await checkInitialBudget(longMessages, longInstructions, tools, 'qwen3.5-27b');
    expect(result.actions).toContain('Tool filtering');
  });
});
```

### 6.2 集成测试

1. 使用 `qwen3.5-27b` 模型测试初始调用
2. 验证日志输出预算估算结果
3. 验证超出限制时的降级策略执行
4. 验证工具输出截断生效

---

## 7. 与现有架构的整合

### 7.1 现有文件修改清单

| 文件 | 修改类型 | 说明 |
|-----|---------|------|
| `model-provider.ts` | 扩展 | 添加 `getModelCapabilities()` |
| `token-counter.ts` | 扩展 | 添加工具/指令估算函数 |
| `agent/create.ts` | 修改 | 集成初始预算检查 |
| `compaction/types.ts` | 更新 | 扩展可压缩工具列表 |
| `tools/*.ts` | 修改 | 使用统一截断配置 |

### 7.2 新增文件清单

| 文件 | 说明 |
|-----|------|
| `model-capabilities.ts` | 模型能力元数据 |
| `compaction/initial-budget-check.ts` | 初始预算检查与降级 |
| `tools/output-limits.ts` | 统一输出截断配置 |

---

## 8. 预期效果

### 8.1 解决的问题

| 问题 | 解决方案 | 预期效果 |
|-----|---------|---------|
| `Range of input length should be [1, 258048]` | 初始预算检查 + 降级策略 | 第一次调用不再超限 |
| 模型上下文限制硬编码 | `MODEL_CAPABILITIES` 配置表 | 支持任意模型动态限制 |
| 工具定义未计入预算 | `estimateToolsTokens()` | 预算计算完整准确 |
| 工具输出过大 | 统一截断配置 + MicroCompact | 工具输出受控，不堵塞上下文 |

### 8.2 性能影响

- **估算开销**: 每次调用前增加 ~5ms 估算时间（可忽略）
- **降级开销**: 仅在超限时执行，正常流程无额外开销
- **压缩效果**: MicroCompact 清除大输出工具可节省 5-20K tokens

---

## 9. 附录：ClaudeCode 参考对照

| ClaudeCode 实现 | 本方案对应 | 状态 |
|----------------|----------|------|
| `getContextWindowForModel()` | `getModelCapabilities()` | ✅ 设计 |
| `AUTOCOMPACT_BUFFER_TOKENS = 13K` | 动态计算 | ✅ 设计 |
| `maxResultSizeChars (100K)` | `TOOL_OUTPUT_LIMITS` | ✅ 设计 |
| `COMPACTABLE_TOOLS` 白名单 | `isCompactableTool()` | ✅ 扩展 |
| `POST_COMPACT_TOKEN_BUDGET = 50K` | 已实现 | ✅ 保持 |
| MicroCompact 时间衰减 | 已实现 | ✅ 保持 |
| Session Memory Compact | 已实现 | ✅ 保持 |
| PTL Degradation | 已实现 | ✅ 保持 |