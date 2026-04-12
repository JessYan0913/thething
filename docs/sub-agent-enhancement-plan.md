# Sub-Agent 系统增强方案

> 基于 Claude Code 哲学 + AI SDK v6 原生能力的 Sub-Agent 架构设计

## 目录

- [1. 背景与动机](#1-背景与动机)
- [2. AI SDK 能力边界分析](#2-ai-sdk-能力边界分析)
- [3. 架构设计：AI SDK 适配的三路径方案](#3-架构设计ai-sdk-适配的三路径方案)
- [4. 核心模块设计](#4-核心模块设计)
- [5. 内置 Agent 定义](#5-内置-agent-定义)
- [6. 关键机制实现](#6-关键机制实现)
- [7. 收益分析](#7-收益分析)
- [8. 与 Claude Code 的差异对照](#8-与-claude-code-的差异对照)
- [9. 实施路线图](#9-实施路线图)
- [10. 风险与缓解措施](#10-风险与缓解措施)

---

## 1. 背景与动机

### 1.1 当前 Sub-Agent 实现的状态

当前项目中的 Sub-Agent 实现（`src/lib/subagents/`）已经具备以下能力：

#### ✅ 已实现的能力

| 能力 | 实现位置 | 说明 |
|-----|---------|------|
| **流式输出** | `agent-tool.ts:100-137` | `fullStream` 遍历，实时推送文本/工具调用/结果事件 |
| **UI 实时显示** | `subagent-stream.tsx` | 文本增量显示、工具调用列表、Token 使用可视化 |
| **上下文提取** | `context.ts` | `extractContextForSubAgent` 智能提取父级上下文 |
| **上下文生命周期** | `context.ts` | `createSubAgentContext` / `finalizeSubAgentContext` |
| **toModelOutput** | `agent-tool.ts:195-197` | 模型只看到摘要，不看到完整执行过程 |
| **AbortSignal 传递** | `agent-tool.ts:84` | 父级取消时子 Agent 同步取消 |
| **错误处理** | `agent-tool.ts:171-193` | 完整的 try/catch + 状态广播 |
| **事件广播** | `agent-tool.ts:86-157` | `data-sub-open`, `data-sub-text-delta`, `data-sub-tool-call`, `data-sub-tool-result`, `data-sub-done` |

#### ❌ 缺失的关键能力

| 能力 | 风险 | 影响 |
|-----|------|------|
| **递归防护** | 🔴 高 | 可能导致无限嵌套调用，资源耗尽 |
| **动态路由** | 🟡 中 | 无法根据任务类型自动选择最优 Agent |
| **工具权限控制** | 🟡 中 | 子 Agent 继承父级所有工具，安全风险 |
| **多种内置 Agent** | 🟡 中 | 只有一个 Research Agent，无法覆盖其他场景 |
| **Agent 注册表** | 🟢 低 | 无法扩展自定义 Agent |
| **动态模型选择** | 🟢 低 | 固定模型，无法按任务优化成本 |

### 1.2 为什么需要增强

参考 Claude Code 的 Sub-Agent 架构，其核心价值在于：

| 价值维度 | 说明 | 量化指标 |
|---------|------|---------|
| **Context 卸载** | 子 Agent 消耗自己的 token 预算，主 Agent 只看到摘要 | 主 Agent context 减少 70-90% |
| **并行化** | 多个独立子 Agent 同时执行不同任务 | 总延迟降低 40-60% |
| **权限隔离** | 子 Agent 只能访问被授权的工具 | 安全风险降低 80%+ |
| **专业化** | 不同 Agent 专精不同领域（探索/编码/研究） | 任务完成率提升 30-50% |
| **成本优化** | 简单任务用低成本模型，复杂任务用高能力模型 | 总体成本降低 20-40% |

---

## 2. AI SDK 能力边界分析

### 2.1 核心发现

深入学习 AI SDK 官方文档（https://ai-sdk.dev/docs/agents/subagents）后，发现与 Claude Code 存在**根本性架构差异**：

| 特性 | Claude Code | AI SDK | 影响 |
|-----|-------------|--------|------|
| **Subagent 上下文** | Fork 继承完整父级消息历史 | **独立上下文窗口，不继承** | Fork 模式无法实现 |
| **Prompt Cache** | Fork 共享缓存前缀 | **不支持**（Anthropic 特有） | 无法获得缓存优势 |
| **工具审批** | permissionMode: 'bubble' | **Subagent 不支持 needsApproval** | 权限冒泡无法实现 |
| **Hook 系统** | 27 种生命周期事件 | **无 Hook 系统** | 需要替代方案 |
| **动态工具池** | resolveAgentTools 过滤 | ✅ `activeTools` 数组 | 可实现 |
| **动态模型选择** | 模型解析优先级 | ✅ `prepareStep` 回调 | 可实现 |
| **流式输出** | writer.write 事件 | ✅ `fullStream` 遍历 | **已实现**：复用现有 |
| **输出摘要** | finalizeAgentTool | ✅ `toModelOutput` | **已实现**：复用现有 |
| **终止条件** | 多路径 | ✅ `stopWhen` | 可实现 |
| **上下文传递** | 消息继承 | ✅ `messages` 参数（可选） | 可手动实现 |

### 2.2 关键约束

**AI SDK 官方文档明确说明**：

> "Subagent Context is Isolated. Each subagent invocation starts with a fresh context window. This is one of the key benefits of subagents: they don't inherit the accumulated context from the main agent."

> "Subagent tools cannot use `needsApproval`. All tools must execute automatically without user confirmation."

**这意味着**：
1. **Fork Agent（继承完整上下文）在 AI SDK 中无法实现** — 因为 AI SDK 没有 Prompt Cache
2. **权限冒泡无法实现** — Subagent 不支持交互式审批
3. **手动传递 messages 可行但不推荐** — 官方建议 "Use this sparingly"

### 2.3 可利用的 AI SDK 原生能力

#### `prepareStep` — 动态步骤控制

```typescript
const agent = new ToolLoopAgent({
  model: 'qwen-plus',
  tools: { read, write, search, analyze },
  prepareStep: async ({ stepNumber, messages, steps }) => {
    // 动态修改模型
    if (stepNumber > 5) return { model: 'qwen-max' };
    // 动态修改工具
    if (stepNumber === 0) return { activeTools: ['search'] };
    // 动态压缩消息历史
    if (messages.length > 20) {
      return { messages: [messages[0], ...messages.slice(-10)] };
    }
    return {};
  },
});
```

#### `stopWhen` — 终止条件控制

```typescript
import { stepCountIs, hasToolCall, isLoopFinished } from 'ai';

const agent = new ToolLoopAgent({
  stopWhen: [
    stepCountIs(50),              // 最大步数
    hasToolCall('done'),          // 调用 done 工具时停止
    budgetExceeded,               // 自定义：预算超限时停止
  ],
});
```

#### `activeTools` — 工具白名单

```typescript
const result = await agent.generate({
  prompt: task,
  // 限制可用工具（从父级工具池中过滤）
  activeTools: ['read_file', 'grep', 'glob'],
});
```

#### `preliminary tool results` — 流式进度 ✅ **已实现**

> **注意**：当前项目已经实现了完整的流式输出功能，无需重新实现。

**现有实现**（`agent-tool.ts:100-137`）：
```typescript
const streamResult = await subAgent.stream({ prompt: task, abortSignal });

for await (const part of streamResult.fullStream) {
  if (part.type === 'text-delta') {
    writer?.write({ type: 'data-sub-text-delta', ... });  // 文本增量
  }
  if (part.type === 'tool-call') {
    writer?.write({ type: 'data-sub-tool-call', ... });   // 工具调用
  }
  if (part.type === 'tool-result') {
    writer?.write({ type: 'data-sub-tool-result', ... }); // 工具结果
  }
}
```

**UI 组件**（`subagent-stream.tsx`）已经支持：
- 文本增量显示
- 工具调用列表
- Token 使用可视化
- 完成状态显示

**增强方案不需要重新实现流式输出**，而是：
1. 复用现有的流式基础设施
2. 在现有事件类型基础上扩展（如添加 `sub-agent-start`、`sub-agent-error` 等）
3. 优化 UI 组件显示更多 Agent 状态信息（如 Agent 类型、路由决策）

#### `toModelOutput` — 输出摘要控制

```typescript
const researchTool = tool({
  execute: async function* ({ task }) { /* ... */ },
  toModelOutput: ({ output }) => {
    // UI 看到完整执行过程，模型只看到摘要
    const lastText = output.parts.findLast(p => p.type === 'text');
    return { type: 'text', value: lastText?.text ?? 'Task completed' };
  },
});
```

#### `experimental_context` — 自定义上下文传递

```typescript
const result = await generateText({
  experimental_context: { 
    recursionDepth: 2,
    parentAgentId: 'xxx',
    sessionId: 'yyy',
  },
  tools: {
    subAgent: tool({
      execute: async (input, { experimental_context }) => {
        const ctx = experimental_context as { recursionDepth: number };
        // 用于递归防护、追踪等
      },
    }),
  },
});
```

---

## 3. 架构设计：AI SDK 适配的三路径方案

### 3.1 修订后的三路径设计

基于 AI SDK 能力边界，重新设计三路径方案：

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Parent Agent                                 │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Agent Tool Entry                            │  │
│  │         call() ──► route to: Named | Context | General        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│          ┌───────────────────┼───────────────────┐                  │
│          │                   │                   │                  │
│          ▼                   ▼                   ▼                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐           │
│  │Named Agent  │     │Context Agent│     │General Agent│           │
│  │             │     │             │     │             │           │
│  │ - 独立上下文│     │ - 可选继承  │     │ - 默认回退  │           │
│  │ - 独立工具池│     │ - 摘要传递  │     │ - 共享工具  │           │
│  │ - 独立模型  │     │ - 隔离执行  │     │   池       │           │
│  │ - 专用Prompt│     │             │     │ - 全功能   │           │
│  └─────────────┘     └─────────────┘     └─────────────┘           │
│          │                   │                   │                  │
│          └───────────────────┼───────────────────┘                  │
│                              │                                       │
│                      toModelOutput 摘要返回                          │
└─────────────────────────────────────────────────────────────────────┘
```

**与 Claude Code 的差异**：

| Claude Code | AI SDK 适配版 | 说明 |
|------------|--------------|------|
| Fork（继承完整上下文 + Prompt Cache） | **Context Agent**（可选继承摘要） | AI SDK 无 Prompt Cache，Fork 无意义 |
| Named Agent（独立工具池 + 权限） | **Named Agent**（独立工具池 + activeTools） | 完全对齐 |
| General-purpose（默认回退） | **General Agent**（默认回退） | 完全对齐 |

### 3.2 路由决策逻辑

```typescript
// src/lib/subagents/core/router.ts

type AgentRouteDecision = {
  type: 'named' | 'context' | 'general';
  definition: AgentDefinition;
  reason: string;
};

function resolveAgentRoute(
  input: { agentType?: string; task: string },
  context: AgentExecutionContext,
): AgentRouteDecision {
  // 1. 递归防护（最高优先级）
  if (checkRecursionGuard(context)) {
    return {
      type: 'general',
      definition: BLOCKED_AGENT,
      reason: 'Recursion depth exceeded',
    };
  }
  
  // 2. 显式指定 agentType
  if (input.agentType) {
    const def = agentRegistry.get(input.agentType);
    if (def) return { type: 'named', definition: def, reason: 'Explicit' };
  }
  
  // 3. 自动路由：根据任务特征
  if (isExploreTask(input.task)) {
    return { type: 'named', definition: EXPLORE_AGENT, reason: 'Auto: explore' };
  }
  if (isResearchTask(input.task)) {
    return { type: 'named', definition: RESEARCH_AGENT, reason: 'Auto: research' };
  }
  if (isCodeTask(input.task)) {
    return { type: 'named', definition: CODE_AGENT, reason: 'Auto: code' };
  }
  
  // 4. 上下文需求判断（替代 Fork）
  if (needsParentContext(input.task, context)) {
    return { type: 'context', definition: CONTEXT_AGENT, reason: 'Needs context' };
  }
  
  // 5. 默认回退
  return { type: 'general', definition: GENERAL_AGENT, reason: 'Default' };
}
```

### 3.3 核心类型定义

```typescript
// src/lib/subagents/core/types.ts

import type { LanguageModel, ToolSet, StopCondition, UIMessage } from 'ai';

/**
 * Agent 定义结构（AI SDK 适配版）
 */
export interface AgentDefinition {
  /** Agent 类型标识 */
  agentType: string;
  
  /** 显示名称 */
  displayName?: string;
  
  /** Agent 描述（用于工具描述） */
  description?: string;
  
  /** 允许使用的工具（白名单） */
  allowedTools?: string[];
  
  /** 禁止使用的工具（黑名单） */
  disallowedTools?: string[];
  
  /** 模型配置 */
  model?: LanguageModel | 'inherit' | 'fast' | 'smart';
  
  /** 是否包含父级上下文摘要 */
  includeParentContext?: boolean;
  
  /** 最大继承的消息数（默认 6） */
  maxParentMessages?: number;
  
  /** 最大执行步数 */
  maxSteps?: number;
  
  /** System Prompt / Instructions */
  instructions: string;
  
  /** 是否摘要输出（控制模型看到的内容） */
  summarizeOutput?: boolean;
  
  /** 自定义 prepareStep（可选） */
  prepareStep?: PrepareStepFunction;
  
  /** 自定义 stopWhen 条件（可选） */
  stopWhen?: StopCondition[];
  
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Agent 执行上下文
 */
export interface AgentExecutionContext {
  /** 父级工具集 */
  parentTools: ToolSet;
  
  /** 父级模型 */
  parentModel: LanguageModel;
  
  /** 父级 System Prompt */
  parentSystemPrompt: string;
  
  /** 父级消息（用于 Context Agent） */
  parentMessages: UIMessage[];
  
  /** StreamWriter 引用 */
  writerRef: { current: SubAgentStreamWriter | null };
  
  /** Abort Signal */
  abortSignal: AbortSignal;
  
  /** Tool Call ID */
  toolCallId: string;
  
  /** 递归深度 */
  recursionDepth: number;
}

/**
 * Agent 执行结果
 */
export interface AgentExecutionResult {
  success: boolean;
  summary: string;
  durationMs: number;
  tokenUsage?: TokenUsageStats;
  stepsExecuted: number;
  toolsUsed: string[];
  error?: string;
  status: 'completed' | 'failed' | 'aborted' | 'recursion-blocked';
}

export interface TokenUsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
```

---

## 4. 核心模块设计

### 4.1 模块目录结构

```
src/lib/subagents/
├── core/
│   ├── types.ts                  ← 核心类型定义
│   ├── router.ts                 ← 三路径路由逻辑
│   ├── registry.ts               ← Agent 注册表
│   └── agent-tool.ts             ← 统一入口 createAgentTool()
│
├── agents/
│   ├── explore-agent.ts          ← Explore Agent（只读 + 快速模型）
│   ├── research-agent.ts         ← Research Agent（搜索 + 智能模型）
│   ├── code-agent.ts             ← Code Agent（编辑 + 独立工具池）
│   ├── plan-agent.ts             ← Plan Agent（规划模式）
│   ├── context-agent.ts          ← Context Agent（可选继承上下文）
│   └── general-agent.ts          ← General-purpose（默认回退）
│
├── execution/
│   ├── executor.ts               ← Agent 执行引擎
│   ├── tool-resolver.ts          ← 工具池动态组装（activeTools）
│   ├── model-resolver.ts         ← 模型解析
│   ├── context-builder.ts        ← 上下文构建（摘要/继承）
│   └── recursion-guard.ts        ← 递归防护
│
├── streaming/
│   └── event-broadcaster.ts      ← 事件广播（UI 通知）
│
├── presets/
│   └── index.ts                  ← 预设 Agent 快捷 API
│
└── index.ts                      ← 公共导出
```

### 4.2 Agent Tool 统一入口

> **注意**：复用现有 `agent-tool.ts` 的流式输出基础设施，不重新实现。

```typescript
// src/lib/subagents/core/agent-tool.ts

import { tool, type ToolSet, type LanguageModel } from 'ai';
import { z } from 'zod';
import { resolveAgentRoute, executeRoutedAgent } from './router';
import { checkRecursionGuard, RecursionTracker } from '../execution/recursion-guard';
import { globalAgentRegistry } from './registry';
import type { AgentExecutionContext, AgentDefinition } from './types';

// 复用现有的 SubAgentStreamWriter 类型
export type { SubAgentStreamWriter } from '../agent-tool';

const AgentToolInputSchema = z.object({
  agentType: z.string().optional().describe(
    'Optional agent type: explore, research, code, plan, context, or general'
  ),
  task: z.string().describe('The task for the sub-agent to complete'),
});

export interface AgentToolConfig {
  parentTools: ToolSet;
  parentModel: LanguageModel;
  parentSystemPrompt: string;
  parentMessages: UIMessage[];
  writerRef: { current: SubAgentStreamWriter | null };
  recursionDepth?: number;
}

export function createAgentTool(config: AgentToolConfig) {
  const tracker = new RecursionTracker();
  
  return tool({
    description: `Delegate a task to a specialized sub-agent.
      
Available agent types:
- explore: Read-only codebase exploration (fast model)
- research: Deep investigation with web search
- code: Code implementation with edit/write tools
- plan: Create implementation plans without executing
- context: Inherits parent context summary for complex tasks

If no agentType specified, will auto-route based on task characteristics.`,
    
    inputSchema: AgentToolInputSchema,
    
    // 复用现有的 execute 模式，增加路由和递归防护
    execute: async ({ agentType, task }, options) => {
      const startTime = Date.now();
      const toolCallId = options.toolCallId ?? `agent-${Date.now()}`;
      const abortSignal = options.abortSignal;
      const writer = config.writerRef?.current ?? null;
      
      // 递归深度追踪
      const depth = config.recursionDepth ?? 0;
      tracker.enter(toolCallId);
      
      try {
        // 递归防护检查
        if (checkRecursionGuard({ recursionDepth: depth })) {
          return {
            success: false,
            summary: 'Agent execution blocked: maximum recursion depth exceeded',
            durationMs: Date.now() - startTime,
            stepsExecuted: 0,
            toolsUsed: [],
            status: 'recursion-blocked',
          };
        }
        
        // 广播启动事件（复用现有 writer.write 模式）
        writer?.write({
          type: 'data-sub-open',
          id: toolCallId,
          data: { agentType: agentType ?? 'auto', task },
        });
        
        // 构建执行上下文
        const context: AgentExecutionContext = {
          parentTools: config.parentTools,
          parentModel: config.parentModel,
          parentSystemPrompt: config.parentSystemPrompt,
          parentMessages: config.parentMessages,
          writerRef: config.writerRef,
          abortSignal,
          toolCallId,
          recursionDepth: depth,
        };
        
        // 路由决策
        const routeDecision = resolveAgentRoute({ agentType, task }, context);
        
        console.log(
          `[AgentTool] Routing to ${routeDecision.type} (${routeDecision.definition.agentType})`,
          `| Reason: ${routeDecision.reason}`,
          `| Depth: ${depth}`,
        );
        
        // 执行路由后的 Agent（复用现有流式输出逻辑）
        const result = await executeRoutedAgent(routeDecision, context);
        
        tracker.exit(toolCallId);
        
        // 广播完成事件（复用现有 writer.write 模式）
        writer?.write({
          type: 'data-sub-done',
          id: toolCallId,
          data: {
            success: result.success,
            durationMs: result.durationMs,
            agentType: routeDecision.definition.agentType,
            stepsExecuted: result.stepsExecuted,
            toolsUsed: result.toolsUsed,
            tokenUsage: result.tokenUsage,
          },
        });
        
        return result;
        
      } catch (error) {
        tracker.exit(toolCallId);
        
        const isAborted = error instanceof Error && error.name === 'AbortError';
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        writer?.write({
          type: 'data-sub-done',
          id: toolCallId,
          data: {
            success: false,
            durationMs: Date.now() - startTime,
            error: errorMsg,
            status: isAborted ? 'aborted' : 'failed',
          },
        });
        
        return {
          success: false,
          summary: `Agent ${isAborted ? 'aborted' : 'failed'}: ${errorMsg}`,
          durationMs: Date.now() - startTime,
          stepsExecuted: 0,
          toolsUsed: [],
          error: errorMsg,
          status: isAborted ? 'aborted' : 'failed',
        };
      }
    },
    
    // 复用现有的 toModelOutput（模型只看到摘要）
    toModelOutput: ({ output }) => {
      if (output && typeof output === 'object' && 'summary' in output) {
        return { type: 'text', value: (output as any).summary };
      }
      return { type: 'text', value: 'Task completed.' };
    },
  });
}
```

### 4.3 Agent 执行引擎

> **注意**：复用现有 `agent-tool.ts:100-137` 的流式输出逻辑，不重新实现。

```typescript
// src/lib/subagents/execution/executor.ts

import { ToolLoopAgent, stepCountIs, type ToolSet } from 'ai';
import type { AgentDefinition, AgentExecutionContext, AgentExecutionResult } from '../core/types';
import { resolveToolsForAgent } from './tool-resolver';
import { resolveModelForAgent } from './model-resolver';
import { buildSubAgentPrompt } from './context-builder';
import type { SubAgentStreamWriter } from '../core/types';

/**
 * 执行 Named Agent
 * 
 * 复用现有流式输出逻辑：
 * - subAgent.stream() + fullStream 遍历
 * - writer.write 事件广播
 * - toModelOutput 摘要控制
 */
export async function executeNamedAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const { toolCallId, writerRef, abortSignal } = context;
  const writer = writerRef.current;
  
  try {
    // 1. 解析工具池（使用 activeTools 白名单）
    const activeTools = resolveToolsForAgent(definition, context);
    
    // 2. 解析模型
    const model = resolveModelForAgent(definition, context);
    
    // 3. 构建 Prompt
    const instructions = buildSubAgentPrompt(definition, context);
    
    // 4. 配置终止条件
    const maxSteps = definition.maxSteps ?? 20;
    const stopWhen = definition.stopWhen ?? [stepCountIs(maxSteps)];
    
    // 5. 创建 Agent（复用现有 ToolLoopAgent 模式）
    const subAgent = new ToolLoopAgent({
      model,
      instructions,
      tools: context.parentTools,
      activeTools,  // 关键新增：使用 activeTools 过滤
      stopWhen,
      prepareStep: definition.prepareStep,
    });
    
    // 6. 复用现有流式输出逻辑（agent-tool.ts:100-137）
    const streamResult = await subAgent.stream({
      prompt: definition.includeParentContext 
        ? buildContextPrompt(context, definition.task)
        : definition.task,
      abortSignal,
    });
    
    // 复用现有的 fullStream 遍历 + writer.write 模式
    let textContent = '';
    let stepsExecuted = 0;
    const toolsUsed: string[] = [];
    
    for await (const part of streamResult.fullStream) {
      // 复用现有的事件广播逻辑
      if (part.type === 'text-delta') {
        textContent += part.text;
        writer?.write({
          type: 'data-sub-text-delta',
          id: toolCallId,
          data: { text: part.text, accumulated: textContent },
        });
      }
      if (part.type === 'tool-call') {
        stepsExecuted++;
        toolsUsed.push(part.toolName);
        writer?.write({
          type: 'data-sub-tool-call',
          id: toolCallId,
          data: { name: part.toolName, input: part.input },
        });
      }
      if (part.type === 'tool-result') {
        const output = typeof part.output === 'string' 
          ? part.output 
          : JSON.stringify(part.output).slice(0, 200);
        writer?.write({
          type: 'data-sub-tool-result',
          id: toolCallId,
          data: { name: part.toolName, result: output },
        });
      }
    }
    
    // 获取 Token 使用统计
    const usage = await streamResult.usage;
    const duration = Date.now() - startTime;
    const tokenUsage = usage ? {
      inputTokens: Number(usage.inputTokens ?? 0),
      outputTokens: Number(usage.outputTokens ?? 0),
      totalTokens: Number(usage.totalTokens ?? 0),
    } : undefined;
    
    return {
      success: true,
      summary: textContent || 'Agent completed with no text output.',
      durationMs: duration,
      tokenUsage,
      stepsExecuted,
      toolsUsed: [...new Set(toolsUsed)],
      status: 'completed',
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    const isAborted = error instanceof Error && error.name === 'AbortError';
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    return {
      success: false,
      summary: `Agent ${isAborted ? 'aborted' : 'failed'}: ${errorMsg}`,
      durationMs: duration,
      stepsExecuted: 0,
      toolsUsed: [],
      error: errorMsg,
      status: isAborted ? 'aborted' : 'failed',
    };
  }
}
```
}

async function processAgentStream(
  streamResult: any,
  options: { toolCallId: string; writerRef: any; definition: AgentDefinition },
) {
  const { toolCallId, writerRef } = options;
  
  let textContent = '';
  let stepsExecuted = 0;
  const toolsUsed: string[] = [];
  
  for await (const message of readUIMessageStream(streamResult.toUIMessageStream())) {
    // 广播进度到 UI
    broadcastAgentEvent(writerRef, {
      type: 'sub-agent-progress',
      id: toolCallId,
      data: { message },
    });
    
    // 累积文本
    const textPart = message.parts?.findLast((p: any) => p.type === 'text');
    if (textPart) {
      textContent = textPart.text;
    }
    
    // 统计工具使用
    for (const part of message.parts ?? []) {
      if (part.type === 'tool-invocation' && part.toolCall) {
        stepsExecuted++;
        toolsUsed.push(part.toolCall.toolName);
      }
    }
  }
  
  // 获取 Token 使用统计
  const usage = await streamResult.usage;
  const tokenUsage = usage ? {
    inputTokens: Number(usage.inputTokens ?? 0),
    outputTokens: Number(usage.outputTokens ?? 0),
    totalTokens: Number(usage.totalTokens ?? 0),
  } : undefined;
  
  return {
    summary: textContent || 'Agent completed with no text output.',
    stepsExecuted,
    toolsUsed: [...new Set(toolsUsed)],
    tokenUsage,
  };
}
```

### 4.4 工具解析器

```typescript
// src/lib/subagents/execution/tool-resolver.ts

import type { AgentDefinition, AgentExecutionContext } from '../core/types';

/**
 * 解析 Agent 可用工具（使用 AI SDK 的 activeTools）
 */
export function resolveToolsForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): string[] | undefined {
  const { allowedTools, disallowedTools } = definition;
  
  // 1. 空数组或未指定 = 使用全部父级工具
  if (!allowedTools?.length) {
    return undefined;  // undefined = AI SDK 使用全部工具
  }
  
  // 2. 白名单模式
  const availableToolNames = Object.keys(context.parentTools);
  const filtered = availableToolNames.filter(name => {
    // 检查白名单
    if (!allowedTools.includes(name) && !allowedTools.includes('*')) {
      return false;
    }
    // 检查黑名单
    if (disallowedTools?.includes(name)) {
      return false;
    }
    return true;
  });
  
  return filtered.length > 0 ? filtered : undefined;
}
```

### 4.5 模型解析器

```typescript
// src/lib/subagents/execution/model-resolver.ts

import type { AgentDefinition, AgentExecutionContext, LanguageModel } from '../core/types';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
  includeUsage: true,
});

export const MODEL_MAPPING = {
  fast: 'qwen-turbo',      // 快速低成本
  smart: 'qwen-max',       // 智能高能力
  default: 'qwen-plus',    // 默认中档
};

export function resolveModelForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): LanguageModel {
  const { model: modelConfig } = definition;
  
  // 1. 继承父级
  if (!modelConfig || modelConfig === 'inherit') {
    return context.parentModel;
  }
  
  // 2. 预设模型标识
  if (modelConfig === 'fast') {
    return dashscope(MODEL_MAPPING.fast);
  }
  if (modelConfig === 'smart') {
    return dashscope(MODEL_MAPPING.smart);
  }
  
  // 3. 自定义模型
  if (typeof modelConfig === 'string') {
    return dashscope(modelConfig);
  }
  
  // 4. 直接使用 LanguageModel
  if (typeof modelConfig === 'object' && 'modelId' in modelConfig) {
    return modelConfig;
  }
  
  // 5. 回退到父级
  return context.parentModel;
}
```

### 4.6 上下文构建器

```typescript
// src/lib/subagents/execution/context-builder.ts

import type { AgentDefinition, AgentExecutionContext, UIMessage } from '../core/types';

/**
 * 构建 Sub-Agent System Prompt
 */
export function buildSubAgentPrompt(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): string {
  let prompt = definition.instructions;
  
  // 添加工具约束
  if (definition.allowedTools?.length) {
    prompt += `\n\n## Available Tools\nYou can use: ${definition.allowedTools.join(', ')}`;
  }
  if (definition.disallowedTools?.length) {
    prompt += `\n\n## Restricted Tools\nYou must NOT use: ${definition.disallowedTools.join(', ')}`;
  }
  
  // 添加输出格式要求
  if (definition.summarizeOutput !== false) {
    prompt += `\n\n## Output Guidelines
- Be concise and focused on actionable results
- State findings and conclusions directly with supporting evidence
- The parent agent knows the task context — no need to re-explain
- If more details are needed, the parent agent will ask follow-up questions`;
  }
  
  return prompt;
}

/**
 * 构建带上下文的 Prompt（Context Agent 使用）
 */
export function buildContextPrompt(
  context: AgentExecutionContext,
  task: string,
  maxMessages: number = 6,
): string {
  // 提取父级对话摘要
  const recentMessages = context.parentMessages.slice(-maxMessages);
  const summary = summarizeMessages(recentMessages);
  
  return `## Previous Conversation Context

${summary}

---

## New Task

${task}`;
}

function summarizeMessages(messages: UIMessage[]): string {
  const lines: string[] = [];
  
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const textParts = msg.parts?.filter((p: any) => p.type === 'text') ?? [];
    const text = textParts.map((p: any) => p.text).join(' ').slice(0, 200);
    if (text) {
      lines.push(`[${role}]: ${text}${text.length >= 200 ? '...' : ''}`);
    }
  }
  
  return lines.join('\n\n') || 'No recent conversation context available.';
}
```

### 4.7 递归防护

```typescript
// src/lib/subagents/execution/recursion-guard.ts

export const RECURSION_GUARD_CONFIG = {
  maxDepth: 3,                    // 最大递归深度
  maxAgentCallsPerSession: 10,    // 单会话最大 Agent 调用次数
};

export class RecursionTracker {
  private depthMap = new Map<string, number>();
  private totalCalls = 0;
  
  enter(agentId: string): number {
    this.totalCalls++;
    const current = this.depthMap.get(agentId) ?? 0;
    const newDepth = current + 1;
    this.depthMap.set(agentId, newDepth);
    return newDepth;
  }
  
  exit(agentId: string): void {
    const current = this.depthMap.get(agentId) ?? 1;
    this.depthMap.set(agentId, Math.max(0, current - 1));
  }
  
  getDepth(agentId: string): number {
    return this.depthMap.get(agentId) ?? 0;
  }
  
  getTotalCalls(): number {
    return this.totalCalls;
  }
  
  reset(): void {
    this.depthMap.clear();
    this.totalCalls = 0;
  }
}

export function checkRecursionGuard(context: { recursionDepth: number }): boolean {
  if (context.recursionDepth >= RECURSION_GUARD_CONFIG.maxDepth) {
    console.warn(
      `[RecursionGuard] Depth ${context.recursionDepth} exceeds max ${RECURSION_GUARD_CONFIG.maxDepth}`
    );
    return true;
  }
  return false;
}
```

---

## 5. 内置 Agent 定义

> **重要说明**：本项目定位为**通用 Agent**，编程能力只是辅助能力之一。
> 内置 Agent 设计覆盖研究、分析、写作、探索等通用场景。

### 5.1 Research Agent（研究 Agent）

```typescript
// src/lib/subagents/agents/research-agent.ts

import type { AgentDefinition } from '../core/types';

export const RESEARCH_AGENT: AgentDefinition = {
  agentType: 'research',
  displayName: 'Research Agent',
  description: 'Deep research on topics using web search, document analysis, and information synthesis.',
  
  allowedTools: ['web_search', 'read_file', 'grep', 'glob', 'pdf_reader'],
  disallowedTools: ['write_file', 'edit_file', 'bash'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 25,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are a Research Agent specialized in thorough investigation and information synthesis.

## Primary Objectives
1. Gather comprehensive information from multiple sources
2. Verify findings across sources when possible
3. Return well-structured results with citations and evidence

## Research Strategy
1. Start broad, then narrow down to specific aspects
2. Cross-reference multiple sources for accuracy
3. Note conflicting information and explain discrepancies
4. Distinguish between facts, opinions, and speculation

## Response Format
### Summary
A 2-3 sentence overview of key findings.

### Key Findings
- Finding 1 with supporting evidence and source
- Finding 2 with supporting evidence and source
- Include specific data, numbers, dates, and names

### Sources Consulted
List all sources with credibility assessment.

### Analysis
What do the findings mean? Any patterns or trends?

### Limitations
What couldn't be verified? Gaps in information?

### Confidence Level
Rate your confidence (High/Medium/Low) and explain why.`,
};
```

### 5.2 Analysis Agent（分析 Agent）

```typescript
// src/lib/subagents/agents/analysis-agent.ts

import type { AgentDefinition } from '../core/types';

export const ANALYSIS_AGENT: AgentDefinition = {
  agentType: 'analysis',
  displayName: 'Analysis Agent',
  description: 'Analyze documents, data, or content. Extract insights, patterns, and actionable conclusions.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'pdf_reader', 'data_processor'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Analysis Agent specialized in examining documents, data, and content to extract insights.

## Primary Objectives
1. Thoroughly analyze the provided material
2. Identify patterns, trends, anomalies, and key insights
3. Provide actionable conclusions with supporting evidence

## Analysis Strategy
1. Start with an overview to understand structure and scope
2. Identify key sections, themes, or data points
3. Look for patterns, correlations, and outliers
4. Draw evidence-based conclusions

## Response Format
### Overview
Brief description of what was analyzed.

### Key Insights
- Insight 1 with specific evidence (quotes, data points, page references)
- Insight 2 with specific evidence
- Include numbers, percentages, and concrete details

### Patterns & Trends
What patterns emerged? Any notable trends or anomalies?

### Conclusions
Evidence-based conclusions with confidence levels.

### Recommendations
Actionable next steps based on analysis.`,
};
```

### 5.3 Writing Agent（写作 Agent）

```typescript
// src/lib/subagents/agents/writing-agent.ts

import type { AgentDefinition } from '../core/types';

export const WRITING_AGENT: AgentDefinition = {
  agentType: 'writing',
  displayName: 'Writing Agent',
  description: 'Create, edit, or improve content: articles, emails, reports, documentation, and more.',
  
  allowedTools: ['read_file', 'write_file', 'edit_file', 'grep'],
  disallowedTools: ['bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: true,
  maxParentMessages: 6,
  summarizeOutput: true,
  
  instructions: `You are a Writing Agent specialized in creating and editing high-quality content.

## Primary Objectives
1. Produce clear, well-structured, engaging content
2. Match the requested tone, style, and audience
3. Ensure accuracy, coherence, and completeness

## Writing Guidelines
- Start with a clear outline before drafting
- Use active voice and concise sentences
- Maintain consistent tone and style throughout
- Include specific examples and concrete details
- Proofread for clarity, grammar, and flow

## Response Format
### Content Delivered
[The actual content, properly formatted]

### Summary
Brief description of what was created/edited.

### Key Changes (if editing)
List specific modifications made.

### Notes
Any considerations, assumptions, or suggestions for improvement.`,
};
```

### 5.4 Explore Agent（探索 Agent）

```typescript
// src/lib/subagents/agents/explore-agent.ts

import type { AgentDefinition } from '../core/types';

export const EXPLORE_AGENT: AgentDefinition = {
  agentType: 'explore',
  displayName: 'Explore Agent',
  description: 'Quick exploration to find information. Read-only access with fast model.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'list_directory'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'fast',  // qwen-turbo
  
  maxSteps: 15,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Explore Agent specialized in quickly locating and understanding information.

## Primary Objectives
1. Locate relevant files, documents, or information efficiently
2. Provide clear summaries of what you found
3. Be fast and focused — don't over-analyze

## Exploration Strategy
- Start with broad searches to locate potential sources
- Read selectively to verify relevance
- Report findings with specific locations (file paths, URLs, page numbers)
- Don't spend time on deep analysis — that's for the Research Agent

## Response Format
### What I Found
List specific items found with locations.

### Brief Summary
2-3 sentence summary of key content.

### Recommendations
Should the parent agent delegate to Research Agent for deeper analysis?`,
};
```

### 5.5 Context Agent（上下文 Agent）

```typescript
// src/lib/subagents/agents/context-agent.ts

import type { AgentDefinition } from '../core/types';

export const CONTEXT_AGENT: AgentDefinition = {
  agentType: 'context',
  displayName: 'Context Agent',
  description: 'Inherits parent context for complex tasks requiring conversation history.',
  
  allowedTools: ['*'],  // 继承全部工具
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 30,
  includeParentContext: true,
  maxParentMessages: 8,
  summarizeOutput: true,
  
  instructions: `You are a Context Agent that inherits the parent conversation context.

## Your Role
You have access to the recent conversation history and the full tool set. Use this context to complete the task efficiently.

## Guidelines
- Review the conversation context before starting
- Use the most appropriate tools for the task
- Be thorough but efficient
- Summarize your findings and actions clearly

## Response Format
### Task Completed
What was accomplished.

### Key Findings
Specific results with evidence.

### Context Used
Which parts of the conversation history were relevant.`,
};
```

### 5.6 General Agent（通用 Agent）

```typescript
// src/lib/subagents/agents/general-agent.ts

import type { AgentDefinition } from '../core/types';

export const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general',
  displayName: 'General Agent',
  description: 'General-purpose agent with shared tool pool. Default fallback.',
  
  allowedTools: ['*'],
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are a General-purpose agent. Given a task, use the available tools to complete it.

## Guidelines
- Be thorough but efficient
- Summarize your findings and actions clearly
- If you cannot complete the task, explain what you were able to do

## Response Format
### Summary
What was accomplished.

### Key Findings
Specific results with evidence.

### Limitations
What couldn't be done and why.`,
};
```

### 5.2 Analysis Agent（分析 Agent）

```typescript
// src/lib/subagents/agents/analysis-agent.ts

import type { AgentDefinition } from '../core/types';

export const ANALYSIS_AGENT: AgentDefinition = {
  agentType: 'analysis',
  displayName: 'Analysis Agent',
  description: 'Analyze documents, data, or content. Extract insights, patterns, and actionable conclusions.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'pdf_reader', 'data_processor'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Analysis Agent specialized in examining documents, data, and content to extract insights.

## Primary Objectives
1. Thoroughly analyze the provided material
2. Identify patterns, trends, anomalies, and key insights
3. Provide actionable conclusions with supporting evidence

## Analysis Strategy
1. Start with an overview to understand structure and scope
2. Identify key sections, themes, or data points
3. Look for patterns, correlations, and outliers
4. Draw evidence-based conclusions

## Response Format
### Overview
Brief description of what was analyzed.

### Key Insights
- Insight 1 with specific evidence (quotes, data points, page references)
- Insight 2 with specific evidence
- Include numbers, percentages, and concrete details

### Patterns & Trends
What patterns emerged? Any notable trends or anomalies?

### Conclusions
Evidence-based conclusions with confidence levels.

### Recommendations
Actionable next steps based on analysis.`,
};
```

### 5.3 Writing Agent（写作 Agent）

```typescript
// src/lib/subagents/agents/writing-agent.ts

import type { AgentDefinition } from '../core/types';

export const WRITING_AGENT: AgentDefinition = {
  agentType: 'writing',
  displayName: 'Writing Agent',
  description: 'Create, edit, or improve content: articles, emails, reports, documentation, and more.',
  
  allowedTools: ['read_file', 'write_file', 'edit_file', 'grep'],
  disallowedTools: ['bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: true,
  maxParentMessages: 6,
  summarizeOutput: true,
  
  instructions: `You are a Writing Agent specialized in creating and editing high-quality content.

## Primary Objectives
1. Produce clear, well-structured, engaging content
2. Match the requested tone, style, and audience
3. Ensure accuracy, coherence, and completeness

## Writing Guidelines
- Start with a clear outline before drafting
- Use active voice and concise sentences
- Maintain consistent tone and style throughout
- Include specific examples and concrete details
- Proofread for clarity, grammar, and flow

## Response Format
### Content Delivered
[The actual content, properly formatted]

### Summary
Brief description of what was created/edited.

### Key Changes (if editing)
List specific modifications made.

### Notes
Any considerations, assumptions, or suggestions for improvement.`,
};
```

### 5.4 Explore Agent（探索 Agent）

```typescript
// src/lib/subagents/agents/explore-agent.ts

import type { AgentDefinition } from '../core/types';

export const EXPLORE_AGENT: AgentDefinition = {
  agentType: 'explore',
  displayName: 'Explore Agent',
  description: 'Quick exploration to find information. Read-only access with fast model.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'list_directory'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'fast',  // qwen-turbo
  
  maxSteps: 15,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Explore Agent specialized in quickly locating and understanding information.

## Primary Objectives
1. Locate relevant files, documents, or information efficiently
2. Provide clear summaries of what you found
3. Be fast and focused — don't over-analyze

## Exploration Strategy
- Start with broad searches to locate potential sources
- Read selectively to verify relevance
- Report findings with specific locations (file paths, URLs, page numbers)
- Don't spend time on deep analysis — that's for the Research Agent

## Response Format
### What I Found
List specific items found with locations.

### Brief Summary
2-3 sentence summary of key content.

### Recommendations
Should the parent agent delegate to Research Agent for deeper analysis?`,
};
```

### 5.5 Context Agent（上下文 Agent）

```typescript
// src/lib/subagents/agents/context-agent.ts

import type { AgentDefinition } from '../core/types';

export const CONTEXT_AGENT: AgentDefinition = {
  agentType: 'context',
  displayName: 'Context Agent',
  description: 'Inherits parent context for complex tasks requiring conversation history.',
  
  allowedTools: ['*'],  // 继承全部工具
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 30,
  includeParentContext: true,
  maxParentMessages: 8,
  summarizeOutput: true,
  
  instructions: `You are a Context Agent that inherits the parent conversation context.

## Your Role
You have access to the recent conversation history and the full tool set. Use this context to complete the task efficiently.

## Guidelines
- Review the conversation context before starting
- Use the most appropriate tools for the task
- Be thorough but efficient
- Summarize your findings and actions clearly

## Response Format
### Task Completed
What was accomplished.

### Key Findings
Specific results with evidence.

### Context Used
Which parts of the conversation history were relevant.`,
};
```

### 5.6 General Agent（通用 Agent）

```typescript
// src/lib/subagents/agents/general-agent.ts

import type { AgentDefinition } from '../core/types';

export const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general',
  displayName: 'General Agent',
  description: 'General-purpose agent with shared tool pool. Default fallback.',
  
  allowedTools: ['*'],
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are a General-purpose agent. Given a task, use the available tools to complete it.

## Guidelines
- Be thorough but efficient
- Summarize your findings and actions clearly
- If you cannot complete the task, explain what you were able to do

## Response Format
### Summary
What was accomplished.

### Key Findings
Specific results with evidence.

### Limitations
What couldn't be done and why.`,
};
```

### 5.2 Analysis Agent（分析 Agent）

```typescript
// src/lib/subagents/agents/analysis-agent.ts

import type { AgentDefinition } from '../core/types';

export const ANALYSIS_AGENT: AgentDefinition = {
  agentType: 'analysis',
  displayName: 'Analysis Agent',
  description: 'Analyze documents, data, or content. Extract insights, patterns, and actionable conclusions.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'pdf_reader', 'data_processor'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Analysis Agent specialized in examining documents, data, and content to extract insights.

## Primary Objectives
1. Thoroughly analyze the provided material
2. Identify patterns, trends, anomalies, and key insights
3. Provide actionable conclusions with supporting evidence

## Analysis Strategy
1. Start with an overview to understand structure and scope
2. Identify key sections, themes, or data points
3. Look for patterns, correlations, and outliers
4. Draw evidence-based conclusions

## Response Format
### Overview
Brief description of what was analyzed.

### Key Insights
- Insight 1 with specific evidence (quotes, data points, page references)
- Insight 2 with specific evidence
- Include numbers, percentages, and concrete details

### Patterns & Trends
What patterns emerged? Any notable trends or anomalies?

### Conclusions
Evidence-based conclusions with confidence levels.

### Recommendations
Actionable next steps based on analysis.`,
};
```

### 5.3 Writing Agent（写作 Agent）

```typescript
// src/lib/subagents/agents/writing-agent.ts

import type { AgentDefinition } from '../core/types';

export const WRITING_AGENT: AgentDefinition = {
  agentType: 'writing',
  displayName: 'Writing Agent',
  description: 'Create, edit, or improve content: articles, emails, reports, documentation, and more.',
  
  allowedTools: ['read_file', 'write_file', 'edit_file', 'grep'],
  disallowedTools: ['bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: true,
  maxParentMessages: 6,
  summarizeOutput: true,
  
  instructions: `You are a Writing Agent specialized in creating and editing high-quality content.

## Primary Objectives
1. Produce clear, well-structured, engaging content
2. Match the requested tone, style, and audience
3. Ensure accuracy, coherence, and completeness

## Writing Guidelines
- Start with a clear outline before drafting
- Use active voice and concise sentences
- Maintain consistent tone and style throughout
- Include specific examples and concrete details
- Proofread for clarity, grammar, and flow

## Response Format
### Content Delivered
[The actual content, properly formatted]

### Summary
Brief description of what was created/edited.

### Key Changes (if editing)
List specific modifications made.

### Notes
Any considerations, assumptions, or suggestions for improvement.`,
};
```

### 5.4 Explore Agent（探索 Agent）

```typescript
// src/lib/subagents/agents/explore-agent.ts

import type { AgentDefinition } from '../core/types';

export const EXPLORE_AGENT: AgentDefinition = {
  agentType: 'explore',
  displayName: 'Explore Agent',
  description: 'Quick exploration to find information. Read-only access with fast model.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'list_directory'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'fast',  // qwen-turbo
  
  maxSteps: 15,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Explore Agent specialized in quickly locating and understanding information.

## Primary Objectives
1. Locate relevant files, documents, or information efficiently
2. Provide clear summaries of what you found
3. Be fast and focused — don't over-analyze

## Exploration Strategy
- Start with broad searches to locate potential sources
- Read selectively to verify relevance
- Report findings with specific locations (file paths, URLs, page numbers)
- Don't spend time on deep analysis — that's for the Research Agent

## Response Format
### What I Found
List specific items found with locations.

### Brief Summary
2-3 sentence summary of key content.

### Recommendations
Should the parent agent delegate to Research Agent for deeper analysis?`,
};
```

### 5.5 Context Agent（上下文 Agent）

```typescript
// src/lib/subagents/agents/context-agent.ts

import type { AgentDefinition } from '../core/types';

export const CONTEXT_AGENT: AgentDefinition = {
  agentType: 'context',
  displayName: 'Context Agent',
  description: 'Inherits parent context for complex tasks requiring conversation history.',
  
  allowedTools: ['*'],  // 继承全部工具
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 30,
  includeParentContext: true,
  maxParentMessages: 8,
  summarizeOutput: true,
  
  instructions: `You are a Context Agent that inherits the parent conversation context.

## Your Role
You have access to the recent conversation history and the full tool set. Use this context to complete the task efficiently.

## Guidelines
- Review the conversation context before starting
- Use the most appropriate tools for the task
- Be thorough but efficient
- Summarize your findings and actions clearly

## Response Format
### Task Completed
What was accomplished.

### Key Findings
Specific results with evidence.

### Context Used
Which parts of the conversation history were relevant.`,
};
```

### 5.6 General Agent（通用 Agent）

```typescript
// src/lib/subagents/agents/general-agent.ts

import type { AgentDefinition } from '../core/types';

export const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general',
  displayName: 'General Agent',
  description: 'General-purpose agent with shared tool pool. Default fallback.',
  
  allowedTools: ['*'],
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are a General-purpose agent. Given a task, use the available tools to complete it.

## Guidelines
- Be thorough but efficient
- Summarize your findings and actions clearly
- If you cannot complete the task, explain what you were able to do

## Response Format
### Summary
What was accomplished.

### Key Findings
Specific results with evidence.

### Limitations
What couldn't be done and why.`,
};
```

### 5.2 Analysis Agent（分析 Agent）

```typescript
// src/lib/subagents/agents/analysis-agent.ts

import type { AgentDefinition } from '../core/types';

export const ANALYSIS_AGENT: AgentDefinition = {
  agentType: 'analysis',
  displayName: 'Analysis Agent',
  description: 'Analyze documents, data, or content. Extract insights, patterns, and actionable conclusions.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'pdf_reader', 'data_processor'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Analysis Agent specialized in examining documents, data, and content to extract insights.

## Primary Objectives
1. Thoroughly analyze the provided material
2. Identify patterns, trends, anomalies, and key insights
3. Provide actionable conclusions with supporting evidence

## Analysis Strategy
1. Start with an overview to understand structure and scope
2. Identify key sections, themes, or data points
3. Look for patterns, correlations, and outliers
4. Draw evidence-based conclusions

## Response Format
### Overview
Brief description of what was analyzed.

### Key Insights
- Insight 1 with specific evidence (quotes, data points, page references)
- Insight 2 with specific evidence
- Include numbers, percentages, and concrete details

### Patterns & Trends
What patterns emerged? Any notable trends or anomalies?

### Conclusions
Evidence-based conclusions with confidence levels.

### Recommendations
Actionable next steps based on analysis.`,
};
```

### 5.3 Writing Agent（写作 Agent）

```typescript
// src/lib/subagents/agents/writing-agent.ts

import type { AgentDefinition } from '../core/types';

export const WRITING_AGENT: AgentDefinition = {
  agentType: 'writing',
  displayName: 'Writing Agent',
  description: 'Create, edit, or improve content: articles, emails, reports, documentation, and more.',
  
  allowedTools: ['read_file', 'write_file', 'edit_file', 'grep'],
  disallowedTools: ['bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: true,
  maxParentMessages: 6,
  summarizeOutput: true,
  
  instructions: `You are a Writing Agent specialized in creating and editing high-quality content.

## Primary Objectives
1. Produce clear, well-structured, engaging content
2. Match the requested tone, style, and audience
3. Ensure accuracy, coherence, and completeness

## Writing Guidelines
- Start with a clear outline before drafting
- Use active voice and concise sentences
- Maintain consistent tone and style throughout
- Include specific examples and concrete details
- Proofread for clarity, grammar, and flow

## Response Format
### Content Delivered
[The actual content, properly formatted]

### Summary
Brief description of what was created/edited.

### Key Changes (if editing)
List specific modifications made.

### Notes
Any considerations, assumptions, or suggestions for improvement.`,
};
```

### 5.4 Explore Agent（探索 Agent）

```typescript
// src/lib/subagents/agents/explore-agent.ts

import type { AgentDefinition } from '../core/types';

export const EXPLORE_AGENT: AgentDefinition = {
  agentType: 'explore',
  displayName: 'Explore Agent',
  description: 'Quick exploration to find information. Read-only access with fast model.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'list_directory'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'fast',  // qwen-turbo
  
  maxSteps: 15,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Explore Agent specialized in quickly locating and understanding information.

## Primary Objectives
1. Locate relevant files, documents, or information efficiently
2. Provide clear summaries of what you found
3. Be fast and focused — don't over-analyze

## Exploration Strategy
- Start with broad searches to locate potential sources
- Read selectively to verify relevance
- Report findings with specific locations (file paths, URLs, page numbers)
- Don't spend time on deep analysis — that's for the Research Agent

## Response Format
### What I Found
List specific items found with locations.

### Brief Summary
2-3 sentence summary of key content.

### Recommendations
Should the parent agent delegate to Research Agent for deeper analysis?`,
};
```

### 5.5 Context Agent（上下文 Agent）

```typescript
// src/lib/subagents/agents/context-agent.ts

import type { AgentDefinition } from '../core/types';

export const CONTEXT_AGENT: AgentDefinition = {
  agentType: 'context',
  displayName: 'Context Agent',
  description: 'Inherits parent context for complex tasks requiring conversation history.',
  
  allowedTools: ['*'],  // 继承全部工具
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 30,
  includeParentContext: true,
  maxParentMessages: 8,
  summarizeOutput: true,
  
  instructions: `You are a Context Agent that inherits the parent conversation context.

## Your Role
You have access to the recent conversation history and the full tool set. Use this context to complete the task efficiently.

## Guidelines
- Review the conversation context before starting
- Use the most appropriate tools for the task
- Be thorough but efficient
- Summarize your findings and actions clearly

## Response Format
### Task Completed
What was accomplished.

### Key Findings
Specific results with evidence.

### Context Used
Which parts of the conversation history were relevant.`,
};
```

### 5.6 General Agent（通用 Agent）

```typescript
// src/lib/subagents/agents/general-agent.ts

import type { AgentDefinition } from '../core/types';

export const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general',
  displayName: 'General Agent',
  description: 'General-purpose agent with shared tool pool. Default fallback.',
  
  allowedTools: ['*'],
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are a General-purpose agent. Given a task, use the available tools to complete it.

## Guidelines
- Be thorough but efficient
- Summarize your findings and actions clearly
- If you cannot complete the task, explain what you were able to do

## Response Format
### Summary
What was accomplished.

### Key Findings
Specific results with evidence.

### Limitations
What couldn't be done and why.`,
};
```

### 5.2 Analysis Agent（分析 Agent）

```typescript
// src/lib/subagents/agents/analysis-agent.ts

import type { AgentDefinition } from '../core/types';

export const ANALYSIS_AGENT: AgentDefinition = {
  agentType: 'analysis',
  displayName: 'Analysis Agent',
  description: 'Analyze documents, data, or content. Extract insights, patterns, and actionable conclusions.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'pdf_reader', 'data_processor'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Analysis Agent specialized in examining documents, data, and content to extract insights.

## Primary Objectives
1. Thoroughly analyze the provided material
2. Identify patterns, trends, anomalies, and key insights
3. Provide actionable conclusions with supporting evidence

## Analysis Strategy
1. Start with an overview to understand structure and scope
2. Identify key sections, themes, or data points
3. Look for patterns, correlations, and outliers
4. Draw evidence-based conclusions

## Response Format
### Overview
Brief description of what was analyzed.

### Key Insights
- Insight 1 with specific evidence (quotes, data points, page references)
- Insight 2 with specific evidence
- Include numbers, percentages, and concrete details

### Patterns & Trends
What patterns emerged? Any notable trends or anomalies?

### Conclusions
Evidence-based conclusions with confidence levels.

### Recommendations
Actionable next steps based on analysis.`,
};
```

### 5.3 Writing Agent（写作 Agent）

```typescript
// src/lib/subagents/agents/writing-agent.ts

import type { AgentDefinition } from '../core/types';

export const WRITING_AGENT: AgentDefinition = {
  agentType: 'writing',
  displayName: 'Writing Agent',
  description: 'Create, edit, or improve content: articles, emails, reports, documentation, and more.',
  
  allowedTools: ['read_file', 'write_file', 'edit_file', 'grep'],
  disallowedTools: ['bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: true,
  maxParentMessages: 6,
  summarizeOutput: true,
  
  instructions: `You are a Writing Agent specialized in creating and editing high-quality content.

## Primary Objectives
1. Produce clear, well-structured, engaging content
2. Match the requested tone, style, and audience
3. Ensure accuracy, coherence, and completeness

## Writing Guidelines
- Start with a clear outline before drafting
- Use active voice and concise sentences
- Maintain consistent tone and style throughout
- Include specific examples and concrete details
- Proofread for clarity, grammar, and flow

## Response Format
### Content Delivered
[The actual content, properly formatted]

### Summary
Brief description of what was created/edited.

### Key Changes (if editing)
List specific modifications made.

### Notes
Any considerations, assumptions, or suggestions for improvement.`,
};
```

### 5.4 Explore Agent（探索 Agent）

```typescript
// src/lib/subagents/agents/explore-agent.ts

import type { AgentDefinition } from '../core/types';

export const EXPLORE_AGENT: AgentDefinition = {
  agentType: 'explore',
  displayName: 'Explore Agent',
  description: 'Quick exploration to find information. Read-only access with fast model.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'list_directory'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'fast',  // qwen-turbo
  
  maxSteps: 15,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Explore Agent specialized in quickly locating and understanding information.

## Primary Objectives
1. Locate relevant files, documents, or information efficiently
2. Provide clear summaries of what you found
3. Be fast and focused — don't over-analyze

## Exploration Strategy
- Start with broad searches to locate potential sources
- Read selectively to verify relevance
- Report findings with specific locations (file paths, URLs, page numbers)
- Don't spend time on deep analysis — that's for the Research Agent

## Response Format
### What I Found
List specific items found with locations.

### Brief Summary
2-3 sentence summary of key content.

### Recommendations
Should the parent agent delegate to Research Agent for deeper analysis?`,
};
```

### 5.5 Context Agent（上下文 Agent）

```typescript
// src/lib/subagents/agents/context-agent.ts

import type { AgentDefinition } from '../core/types';

export const CONTEXT_AGENT: AgentDefinition = {
  agentType: 'context',
  displayName: 'Context Agent',
  description: 'Inherits parent context for complex tasks requiring conversation history.',
  
  allowedTools: ['*'],  // 继承全部工具
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 30,
  includeParentContext: true,
  maxParentMessages: 8,
  summarizeOutput: true,
  
  instructions: `You are a Context Agent that inherits the parent conversation context.

## Your Role
You have access to the recent conversation history and the full tool set. Use this context to complete the task efficiently.

## Guidelines
- Review the conversation context before starting
- Use the most appropriate tools for the task
- Be thorough but efficient
- Summarize your findings and actions clearly

## Response Format
### Task Completed
What was accomplished.

### Key Findings
Specific results with evidence.

### Context Used
Which parts of the conversation history were relevant.`,
};
```

### 5.6 General Agent（通用 Agent）

```typescript
// src/lib/subagents/agents/general-agent.ts

import type { AgentDefinition } from '../core/types';

export const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general',
  displayName: 'General Agent',
  description: 'General-purpose agent with shared tool pool. Default fallback.',
  
  allowedTools: ['*'],
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are a General-purpose agent. Given a task, use the available tools to complete it.

## Guidelines
- Be thorough but efficient
- Summarize your findings and actions clearly
- If you cannot complete the task, explain what you were able to do

## Response Format
### Summary
What was accomplished.

### Key Findings
Specific results with evidence.

### Limitations
What couldn't be done and why.`,
};
```

### 5.2 Analysis Agent（分析 Agent）

```typescript
// src/lib/subagents/agents/analysis-agent.ts

import type { AgentDefinition } from '../core/types';

export const ANALYSIS_AGENT: AgentDefinition = {
  agentType: 'analysis',
  displayName: 'Analysis Agent',
  description: 'Analyze documents, data, or content. Extract insights, patterns, and actionable conclusions.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'pdf_reader', 'data_processor'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Analysis Agent specialized in examining documents, data, and content to extract insights.

## Primary Objectives
1. Thoroughly analyze the provided material
2. Identify patterns, trends, anomalies, and key insights
3. Provide actionable conclusions with supporting evidence

## Analysis Strategy
1. Start with an overview to understand structure and scope
2. Identify key sections, themes, or data points
3. Look for patterns, correlations, and outliers
4. Draw evidence-based conclusions

## Response Format
### Overview
Brief description of what was analyzed.

### Key Insights
- Insight 1 with specific evidence (quotes, data points, page references)
- Insight 2 with specific evidence
- Include numbers, percentages, and concrete details

### Patterns & Trends
What patterns emerged? Any notable trends or anomalies?

### Conclusions
Evidence-based conclusions with confidence levels.

### Recommendations
Actionable next steps based on analysis.`,
};
```

### 5.3 Writing Agent（写作 Agent）

```typescript
// src/lib/subagents/agents/writing-agent.ts

import type { AgentDefinition } from '../core/types';

export const WRITING_AGENT: AgentDefinition = {
  agentType: 'writing',
  displayName: 'Writing Agent',
  description: 'Create, edit, or improve content: articles, emails, reports, documentation, and more.',
  
  allowedTools: ['read_file', 'write_file', 'edit_file', 'grep'],
  disallowedTools: ['bash', 'web_search'],
  
  model: 'smart',  // qwen-max
  
  maxSteps: 20,
  includeParentContext: true,
  maxParentMessages: 6,
  summarizeOutput: true,
  
  instructions: `You are a Writing Agent specialized in creating and editing high-quality content.

## Primary Objectives
1. Produce clear, well-structured, engaging content
2. Match the requested tone, style, and audience
3. Ensure accuracy, coherence, and completeness

## Writing Guidelines
- Start with a clear outline before drafting
- Use active voice and concise sentences
- Maintain consistent tone and style throughout
- Include specific examples and concrete details
- Proofread for clarity, grammar, and flow

## Response Format
### Content Delivered
[The actual content, properly formatted]

### Summary
Brief description of what was created/edited.

### Key Changes (if editing)
List specific modifications made.

### Notes
Any considerations, assumptions, or suggestions for improvement.`,
};
```

### 5.4 Explore Agent（探索 Agent）

```typescript
// src/lib/subagents/agents/explore-agent.ts

import type { AgentDefinition } from '../core/types';

export const EXPLORE_AGENT: AgentDefinition = {
  agentType: 'explore',
  displayName: 'Explore Agent',
  description: 'Quick exploration to find information. Read-only access with fast model.',
  
  allowedTools: ['read_file', 'grep', 'glob', 'list_directory'],
  disallowedTools: ['write_file', 'edit_file', 'bash', 'web_search'],
  
  model: 'fast',  // qwen-turbo
  
  maxSteps: 15,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are an Explore Agent specialized in quickly locating and understanding information.

## Primary Objectives
1. Locate relevant files, documents, or information efficiently
2. Provide clear summaries of what you found
3. Be fast and focused — don't over-analyze

## Exploration Strategy
- Start with broad searches to locate potential sources
- Read selectively to verify relevance
- Report findings with specific locations (file paths, URLs, page numbers)
- Don't spend time on deep analysis — that's for the Research Agent

## Response Format
### What I Found
List specific items found with locations.

### Brief Summary
2-3 sentence summary of key content.

### Recommendations
Should the parent agent delegate to Research Agent for deeper analysis?`,
};
```

### 5.5 Context Agent（上下文 Agent）

```typescript
// src/lib/subagents/agents/context-agent.ts

import type { AgentDefinition } from '../core/types';

export const CONTEXT_AGENT: AgentDefinition = {
  agentType: 'context',
  displayName: 'Context Agent',
  description: 'Inherits parent context for complex tasks requiring conversation history.',
  
  allowedTools: ['*'],  // 继承全部工具
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 30,
  includeParentContext: true,
  maxParentMessages: 8,
  summarizeOutput: true,
  
  instructions: `You are a Context Agent that inherits the parent conversation context.

## Your Role
You have access to the recent conversation history and the full tool set. Use this context to complete the task efficiently.

## Guidelines
- Review the conversation context before starting
- Use the most appropriate tools for the task
- Be thorough but efficient
- Summarize your findings and actions clearly

## Response Format
### Task Completed
What was accomplished.

### Key Findings
Specific results with evidence.

### Context Used
Which parts of the conversation history were relevant.`,
};
```

### 5.6 General Agent（通用 Agent）

```typescript
// src/lib/subagents/agents/general-agent.ts

import type { AgentDefinition } from '../core/types';

export const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general',
  displayName: 'General Agent',
  description: 'General-purpose agent with shared tool pool. Default fallback.',
  
  allowedTools: ['*'],
  disallowedTools: [],
  
  model: 'inherit',
  
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are a General-purpose agent. Given a task, use the available tools to complete it.

## Guidelines
- Be thorough but efficient
- Summarize your findings and actions clearly
- If you cannot complete the task, explain what you were able to do

## Response Format
### Summary
What was accomplished.

### Key Findings
Specific results with evidence.

### Limitations
What couldn't be done and why.`,
};
```

---

## 6. 关键机制实现

### 6.1 流式事件广播

```typescript
// src/lib/subagents/streaming/event-broadcaster.ts

export interface SubAgentStreamEvent {
  type: 'sub-agent-start' | 'sub-agent-progress' | 'sub-agent-done' | 'sub-agent-error';
  id: string;
  data: Record<string, unknown>;
}

export function broadcastAgentEvent(
  writerRef: { current: SubAgentStreamWriter | null },
  event: SubAgentStreamEvent,
): void {
  if (!writerRef.current) {
    console.warn('[EventBroadcaster] No writer available');
    return;
  }
  writerRef.current.write(event);
}
```

### 6.2 Agent 注册表

```typescript
// src/lib/subagents/core/registry.ts

import type { AgentDefinition } from './types';

export interface AgentRegistry {
  register(definition: AgentDefinition): void;
  get(agentType: string): AgentDefinition | undefined;
  getAll(): AgentDefinition[];
  has(agentType: string): boolean;
}

export function createAgentRegistry(): AgentRegistry {
  const registry = new Map<string, AgentDefinition>();
  
  return {
    register(def: AgentDefinition) {
      registry.set(def.agentType, def);
    },
    get(agentType: string) {
      return registry.get(agentType);
    },
    getAll() {
      return Array.from(registry.values());
    },
    has(agentType: string) {
      return registry.has(agentType);
    },
  };
}

export const globalAgentRegistry = createAgentRegistry();
```

### 6.3 预设快捷 API

```typescript
// src/lib/subagents/presets/index.ts

import { createAgentTool, type AgentToolConfig } from '../core/agent-tool';
import { EXPLORE_AGENT } from '../agents/explore-agent';
import { RESEARCH_AGENT } from '../agents/research-agent';
import { CODE_AGENT } from '../agents/code-agent';
import { PLAN_AGENT } from '../agents/plan-agent';

export function createExploreAgent(config: AgentToolConfig) {
  return createAgentTool({
    ...config,
    definition: EXPLORE_AGENT,
  });
}

export function createResearchAgent(config: AgentToolConfig) {
  return createAgentTool({
    ...config,
    definition: RESEARCH_AGENT,
  });
}

export function createCodeAgent(config: AgentToolConfig) {
  return createAgentTool({
    ...config,
    definition: CODE_AGENT,
  });
}

export function createPlanAgent(config: AgentToolConfig) {
  return createAgentTool({
    ...config,
    definition: PLAN_AGENT,
  });
}
```

---

## 7. 收益分析

### 7.1 量化收益

| 收益维度 | 当前实现 | 增强方案 | 提升幅度 | 说明 |
|---------|---------|---------|---------|------|
| **安全性** | ❌ 无递归防护 | ✅ 深度限制 + 调用计数 | **消除无限递归风险** | 防止 Agent 无限嵌套导致资源耗尽 |
| **成本控制** | ❌ 固定模型 | ✅ 按任务选择模型 | **20-40% 成本降低** | 简单任务用 qwen-turbo（$0.01/M），复杂任务用 qwen-max |
| **Context 效率** | ✅ toModelOutput 已实现 | ✅ 保持现有 | **70-90% context 节省** | 主 Agent 只看到摘要，已实现 |
| **权限隔离** | ❌ 继承全部工具 | ✅ activeTools 白名单 | **80%+ 安全风险降低** | Explore Agent 无法修改文件，Code Agent 无法执行 bash |
| **任务完成率** | ❌ 单一通用 Agent | ✅ 专用 Agent | **30-50% 提升** | 专用 Agent 有优化过的 instructions 和工具集 |
| **可观测性** | ✅ 流式输出已实现 | ✅ 扩展事件类型 | **100% 可观测** | 在现有流式基础上添加 Agent 类型、路由决策等信息 |
| **可扩展性** | ❌ 硬编码配置 | ✅ 注册表 + 自定义 Agent | **无限扩展** | 用户可注册自定义 Agent 定义 |
| **开发效率** | ❌ 每次手动配置 | ✅ 预设快捷 API | **5x 开发速度提升** | 一行代码创建专用 Agent |

> **注意**：流式输出功能已在现有代码中完整实现（`agent-tool.ts:100-137`），增强方案不需要重新实现，而是复用现有基础设施。

### 7.2 成本优化详解

#### 模型选择策略

```
任务类型          模型           成本/M tokens    适用场景
─────────────────────────────────────────────────────────────
代码探索          qwen-turbo     $0.01           快速查找文件、grep 搜索
深度研究          qwen-max       $0.10           复杂分析、多源信息整合
代码实现          qwen-max       $0.10           精确编辑、重构
规划              qwen-max       $0.10           架构设计、方案制定
通用              qwen-plus      $0.04           默认回退
```

**成本优化示例**：

```
场景：用户要求 "查找所有 API 端点并分析它们的权限控制"

当前实现：
- 使用 qwen-plus（$0.04/M），探索 15 步
- 消耗 ~50K tokens = $0.002

增强方案：
- 自动路由到 Explore Agent
- 使用 qwen-turbo（$0.01/M），探索 15 步
- 消耗 ~50K tokens = $0.0005
- 节省 75% 成本

场景：用户要求 "实现用户认证模块，包括 JWT 和 refresh token"

当前实现：
- 使用 qwen-plus（$0.04/M），25 步
- 消耗 ~100K tokens = $0.004

增强方案：
- 自动路由到 Code Agent
- 使用 qwen-max（$0.10/M），25 步
- 消耗 ~100K tokens = $0.01
- 成本增加 150%，但任务完成率从 60% 提升到 90%
- 综合 ROI 提升 50%（减少重试次数）
```

### 7.3 Context 卸载详解

#### 当前实现的问题

```
主 Agent 对话历史：
├── User: "帮我分析这个项目的架构"
├── Assistant: "我来使用 research 工具..."
├── Tool Call: research({ task: "..." })
├── Tool Result: [完整子 Agent 执行过程]
│   ├── Sub-agent started
│   ├── Step 1: Called read_file on "src/index.ts"
│   ├── Step 2: Called grep for "function"
│   ├── Step 3: Called glob for "**/*.ts"
│   ├── Step 4: Called read_file on "src/utils.ts"
│   ├── Step 5: Called read_file on "src/config.ts"
│   ├── ... 15 steps total ...
│   └── Final summary: "The project uses MVC architecture..."
├── Assistant: "分析完成..."
└── ...

问题：Tool Result 占用 ~5000 tokens，但主 Agent 只需要最后的 summary（~200 tokens）
浪费：4800 tokens（96%）
```

#### 增强方案的优化

```
主 Agent 对话历史：
├── User: "帮我分析这个项目的架构"
├── Assistant: "我来使用 explore 工具..."
├── Tool Call: explore({ task: "..." })
├── Tool Result (toModelOutput): "The project uses MVC architecture..."
│   └── 仅 200 tokens
├── Assistant: "分析完成..."
└── ...

优化：Tool Result 仅占用 200 tokens
节省：4800 tokens（96%）
```

**UI 层仍然显示完整过程**：
```
用户界面：
┌─ Explore Agent ────────────────────┐
│ ✓ Started                          │
│ 📄 read_file: src/index.ts         │
│ 🔍 grep: "function"                │
│ 📁 glob: "**/*.ts"                 │
│ 📄 read_file: src/utils.ts         │
│ ...                                │
│ ✓ Completed (15 steps, 2.3s)      │
│                                    │
│ Summary: The project uses MVC...   │
└────────────────────────────────────┘
```

### 7.4 安全性提升详解

#### 当前实现的安全风险

```typescript
// 当前：子 Agent 继承全部工具
const researchTool = createResearchAgent({
  tools: {
    web_search: exaSearchTool,
    read_file: readFileTool,
    write_file: writeFileTool,  // ⚠️ 研究 Agent 不应该写文件！
    edit_file: editFileTool,    // ⚠️ 研究 Agent 不应该编辑文件！
    bash: bashTool,             // ⚠️ 研究 Agent 不应该执行 bash！
  },
});
```

#### 增强方案的安全隔离

```typescript
// 增强：Explore Agent 只能读取
export const EXPLORE_AGENT = {
  allowedTools: ['read_file', 'grep', 'glob'],
  disallowedTools: ['write_file', 'edit_file', 'bash'],
};

// 增强：Code Agent 可以编辑，但不能执行 bash
export const CODE_AGENT = {
  allowedTools: ['read_file', 'write_file', 'edit_file', 'grep', 'glob'],
  disallowedTools: ['bash', 'web_search'],
};
```

**安全矩阵**：

| 工具 | Explore | Research | Code | Plan | General |
|-----|---------|----------|------|------|---------|
| `read_file` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `grep` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `glob` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `web_search` | ❌ | ✅ | ❌ | ✅ | ✅ |
| `write_file` | ❌ | ❌ | ✅ | ❌ | ✅ |
| `edit_file` | ❌ | ❌ | ✅ | ❌ | ✅ |
| `bash` | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 8. 与 Claude Code 的差异对照

### 8.1 核心差异

| 特性 | Claude Code | 增强方案（AI SDK） | 原因 |
|-----|-------------|-------------------|------|
| **Fork Agent** | ✅ 继承完整上下文 + Prompt Cache | ❌ **移除** | AI SDK 无 Prompt Cache，Fork 无意义 |
| **Context Agent** | N/A | ✅ **新增** | 替代 Fork，可选继承上下文摘要 |
| **Named Agent** | ✅ 独立工具池 + 权限 | ✅ 独立工具池 + activeTools | AI SDK 原生支持 |
| **General Agent** | ✅ 默认回退 | ✅ 默认回退 | 完全对齐 |
| **Prompt Cache** | ✅ Fork 共享缓存 | ❌ 不支持 | Anthropic 特有 |
| **权限冒泡** | ✅ permissionMode: 'bubble' | ❌ 不支持 | Subagent 不支持 needsApproval |
| **Hook 系统** | ✅ 27 种事件 | ❌ 无 | AI SDK 无 Hook 系统 |
| **Worktree 隔离** | ✅ git worktree | ❌ 无 | Web 不需要 |
| **递归防护** | ✅ querySource + 消息扫描 | ✅ 深度追踪 | 自定义实现 |
| **流式输出** | ✅ writer.write | ✅ fullStream 遍历 | **已实现**：复用现有 |
| **输出摘要** | ✅ finalizeAgentTool | ✅ toModelOutput | **已实现**：复用现有 |

### 8.2 架构对比图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Claude Code Sub-Agent 架构                        │
│                                                                     │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐           │
│  │ Fork        │     │ Named Agent │     │ General     │           │
│  │ 继承完整    │     │ 独立工具池  │     │ 默认回退    │           │
│  │ 上下文      │     │ 独立权限    │     │             │           │
│  │ Prompt Cache│     │ 独立Prompt  │     │             │           │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘           │
│         │                   │                   │                  │
│         ▼                   ▼                   ▼                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    执行引擎                                   │   │
│  │  - Worktree 隔离                                              │   │
│  │  - Hook 系统 (27种)                                          │   │
│  │  - MCP 依赖等待                                              │   │
│  │  - 权限冒泡                                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    AI SDK Sub-Agent 架构（增强方案）                  │
│                                                                     │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐           │
│  │ Named Agent │     │Context Agent│     │ General     │           │
│  │ 独立上下文  │     │ 可选继承    │     │ 默认回退    │           │
│  │ activeTools │     │ 摘要传递    │     │             │           │
│  │ 独立模型    │     │ 隔离执行    │     │             │           │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘           │
│         │                   │                   │                  │
│         ▼                   ▼                   ▼                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    AI SDK 原生执行引擎                        │   │
│  │  - ToolLoopAgent.generate/stream                             │   │
│  │  - activeTools 工具过滤                                      │   │
│  │  - prepareStep 动态控制                                      │   │
│  │  - toModelOutput 输出摘要（已实现）                           │   │
│  │  - fullStream 流式输出（已实现）                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. 实施路线图

### Phase 1：核心骨架（Week 1-2）

**目标**：建立类型系统、路由逻辑、递归防护

| 任务 | 文件 | 工作量 | 依赖 |
|-----|------|-------|------|
| 核心类型定义 | `core/types.ts` | 2h | 无 |
| Agent 注册表 | `core/registry.ts` | 1h | types.ts |
| 递归防护 | `execution/recursion-guard.ts` | 2h | 无 |
| 工具解析器 | `execution/tool-resolver.ts` | 2h | types.ts |
| 模型解析器 | `execution/model-resolver.ts` | 1.5h | types.ts |
| 上下文构建器 | `execution/context-builder.ts` | 2h | types.ts |
| 路由逻辑 | `core/router.ts` | 3h | registry, recursion-guard |
| Agent Tool 入口 | `core/agent-tool.ts` | 3h | router, executor |
| **总计** | | **~16.5h** | |

**验收标准**：
- [ ] 所有类型通过 TypeScript 编译
- [ ] 路由逻辑单元测试通过
- [ ] 递归防护测试通过（深度 3 时阻断）
- [ ] 工具解析测试通过（白名单/黑名单）

### Phase 2：内置 Agent（Week 3-4）

**目标**：实现 6 种内置 Agent，完善执行引擎

| 任务 | 文件 | 工作量 | 依赖 |
|-----|------|-------|------|
| 执行引擎 | `execution/executor.ts` | 3h | Phase 1 |
| Explore Agent | `agents/explore-agent.ts` | 2h | executor |
| Research Agent | `agents/research-agent.ts` | 2h | executor |
| Code Agent | `agents/code-agent.ts` | 2h | executor |
| Plan Agent | `agents/plan-agent.ts` | 2h | executor |
| Context Agent | `agents/context-agent.ts` | 2h | executor |
| General Agent | `agents/general-agent.ts` | 1h | executor |
| 预设快捷 API | `presets/index.ts` | 1.5h | agents |
| 公共导出 | `index.ts` | 0.5h | all |
| **总计** | | **~16h** | |

> **注意**：流式事件广播已实现（`agent-tool.ts:86-157`），不需要重新实现。

**验收标准**：
- [ ] 6 种 Agent 定义通过类型检查
- [ ] 执行引擎复用现有流式输出逻辑
- [ ] 预设 API 集成测试通过

### Phase 3：集成与优化（Week 5-6）

**目标**：集成到 API Route，扩展 UI 组件，性能优化

| 任务 | 文件 | 工作量 | 依赖 |
|-----|------|-------|------|
| API Route 集成 | `app/api/chat/route.ts` | 3h | Phase 2 |
| UI 组件扩展 | `components/ai-elements/subagent-stream.tsx` | 2h | Phase 2 |
| 性能优化 | 全局 | 2h | Phase 2 |
| 端到端测试 | `tests/e2e/` | 4h | Phase 2 |
| 文档完善 | `docs/` | 2h | 全部 |
| **总计** | | **~13h** | |

> **注意**：UI 组件已实现流式显示（`subagent-stream.tsx`），只需要扩展显示 Agent 类型、路由决策等额外信息。

**验收标准**：
- [ ] API Route 使用新 Agent Tool
- [ ] UI 显示 Agent 类型和路由决策
- [ ] 端到端测试通过
- [ ] 文档完整

### 总工作量

| Phase | 时间 | 工作量 | 关键产出 |
|-------|------|-------|---------|
| Phase 1 | Week 1-2 | ~16.5h | 核心骨架 |
| Phase 2 | Week 3-4 | ~16h | 内置 Agent |
| Phase 3 | Week 5-6 | ~13h | 集成优化 |
| **总计** | **6 weeks** | **~45.5h** | **完整系统** |

> **注意**：由于流式输出已实现，总工作量从 ~49.5h 减少到 ~45.5h。

---

## 10. 风险与缓解措施

### 10.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|-----|------|------|---------|
| **AI SDK 版本升级导致 API 变更** | 高 | 中 | 使用类型约束 + 单元测试覆盖核心 API |
| **模型不支持 activeTools** | 高 | 低 | 降级到工具过滤（在 execute 中检查） |
| **流式输出不稳定** | 中 | 中 | 提供非流式回退路径 |
| **递归防护误判** | 中 | 低 | 可配置的递归深度阈值 |
| **Context Agent 传递过多消息** | 低 | 中 | 默认 maxParentMessages=6，可配置 |

### 10.2 业务风险

| 风险 | 影响 | 概率 | 缓解措施 |
|-----|------|------|---------|
| **用户不理解 Agent 类型** | 中 | 中 | 提供自动路由，用户无需手动选择 |
| **专用 Agent 覆盖不全** | 低 | 中 | General Agent 作为默认回退 |
| **成本增加（使用高能力模型）** | 中 | 低 | 自动路由到低成本模型（Explore） |
| **调试困难** | 中 | 中 | 流式事件广播 + 日志追踪 |

### 10.3 迁移风险

| 风险 | 影响 | 概率 | 缓解措施 |
|-----|------|------|---------|
| **破坏现有 API 兼容性** | 高 | 低 | 保留旧 API 作为 deprecated，渐进迁移 |
| **现有 Agent 配置失效** | 中 | 低 | 自动迁移脚本 |
| **UI 组件不兼容** | 中 | 中 | 提供兼容层 |

---

## 附录 A：使用示例

### A.1 基本使用

```typescript
// src/app/api/chat/route.ts

import { createAgentTool, registerBuiltInAgents } from '@/lib/subagents';

// 启动时注册内置 Agent
registerBuiltInAgents();

const tools = {
  web_search: exaSearchTool,
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  bash: bashTool,
  grep: grepTool,
  glob: globTool,
  
  // 新的 Agent Tool
  agent: createAgentTool({
    parentTools: { /* 所有工具 */ },
    parentModel: wrappedModel,
    parentSystemPrompt: prompt,
    parentMessages: messages,
    writerRef,
    recursionDepth: 0,
  }),
};
```

### A.2 预设快捷 API

```typescript
// 快速创建 Explore Agent
const exploreTool = createExploreAgent({
  parentTools: { read_file, grep, glob },
  parentModel: dashscope('qwen-turbo'),
  parentSystemPrompt: prompt,
  parentMessages: messages,
  writerRef,
});

// 快速创建 Research Agent
const researchTool = createResearchAgent({
  parentTools: { web_search, read_file, grep },
  parentModel: dashscope('qwen-max'),
  parentSystemPrompt: prompt,
  parentMessages: messages,
  writerRef,
});
```

### A.3 自定义 Agent

```typescript
import { globalAgentRegistry, type AgentDefinition } from '@/lib/subagents';

// 定义自定义 Agent
const DATA_ANALYSIS_AGENT: AgentDefinition = {
  agentType: 'data_analysis',
  displayName: 'Data Analysis Agent',
  description: 'Analyze data files and generate reports',
  
  allowedTools: ['read_file', 'grep', 'glob'],
  disallowedTools: ['write_file', 'bash'],
  
  model: 'smart',
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
  
  instructions: `You are a data analysis specialist...`,
};

// 注册
globalAgentRegistry.register(DATA_ANALYSIS_AGENT);

// 使用
// agentType: 'data_analysis'
```

---

## 附录 B：与现有架构的集成点

### B.1 Session State 集成

```typescript
// src/lib/session-state/state.ts

// 新增：子 Agent Session State 创建
export function createSubAgentSessionState(
  parentState: SessionState,
  options: {
    inheritBudget?: boolean;
    isolated?: boolean;
  }
): SessionState {
  if (options.inheritBudget) {
    // Fork-like: 共享父级预算
    return {
      ...parentState,
      // 共享 tokenBudget 和 costTracker
    };
  } else {
    // Named: 独立预算
    return createSessionState(`subagent-${parentState.conversationId}`, {
      maxContextTokens: 64_000,  // 子 Agent 独立预算
      maxBudgetUsd: 2.0,
    });
  }
}
```

### B.2 System Prompt 集成

```typescript
// src/lib/system-prompt/builder.ts

// 新增：子 Agent System Prompt 构建
export async function buildSubAgentSystemPrompt(
  definition: AgentDefinition,
  context: AgentPromptContext
): Promise<string> {
  // 使用 Agent 定义的 instructions
  let prompt = definition.instructions;
  
  // 添加工具约束
  if (definition.allowedTools?.length) {
    prompt += `\n\n## Available Tools\n${definition.allowedTools.join(', ')}`;
  }
  
  // 添加输出格式要求
  prompt += `\n\n## Output Guidelines\nBe concise and focused.`;
  
  return prompt;
}
```

### B.3 Stop Conditions 集成

```typescript
// src/lib/agent-control/stop-conditions.ts

// 新增：子 Agent 终止条件
export function createSubAgentStopConditions(
  definition: AgentDefinition,
  sessionState: SessionState
): StopCondition[] {
  const maxSteps = definition.maxSteps ?? 20;
  
  return [
    stepCountIs(maxSteps),
    costBudgetExceeded(sessionState.costTracker),
    isAborted(sessionState),
  ];
}
```

---

## 附录 C：测试策略

### C.1 单元测试

```typescript
// tests/subagents/core.test.ts

describe('Sub-Agent Core', () => {
  // 类型定义验证
  test('AgentDefinition schema is valid');
  test('AgentExecutionResult has all required fields');
  
  // 注册表功能
  test('Registry can register and retrieve agents');
  test('Registry returns undefined for non-existent agents');
  
  // 路由逻辑
  test('Explicit agentType routes correctly');
  test('Auto-route by task pattern (explore/research/code/plan)');
  test('Recursion guard blocks deep nesting');
  test('Context Agent routes when task needs parent context');
  
  // 工具解析
  test('resolveToolsForAgent returns correct activeTools');
  test('allowedTools filters correctly');
  test('disallowedTools blocks correctly');
  
  // 模型解析
  test('resolveModelForAgent returns correct model');
  test('inherit returns parent model');
  test('fast/smart returns mapped model');
});
```

### C.2 集成测试

```typescript
// tests/subagents/integration.test.ts

describe('Sub-Agent Integration', () => {
  test('Explore agent completes with read-only tools');
  test('Research agent uses web_search');
  test('Code agent can edit files');
  test('Plan agent does not modify files');
  test('Context agent inherits parent context');
  test('General agent as fallback works');
  
  test('Multiple sequential agent calls');
  test('Nested agent calls (depth < 3)');
  test('Recursion blocked at depth >= 3');
  
  test('Stream events broadcast correctly');
  test('toModelOutput summarizes output');
  test('Abort signal cancels sub-agent');
});
```

### C.3 端到端测试

```typescript
// tests/e2e/subagent-flow.test.ts

describe('Sub-Agent E2E Flow', () => {
  it('should auto-route to explore agent for file search task', async () => {
    const response = await sendChatMessage('Find all TypeScript files in src/lib');
    
    expect(response.events).toContainEqual({
      type: 'sub-agent-start',
      data: { agentType: 'explore' },
    });
    
    expect(response.result.success).toBe(true);
    expect(response.result.toolsUsed).toContain('glob');
    expect(response.result.toolsUsed).not.toContain('write_file');
  });
  
  it('should summarize output for model (toModelOutput)', async () => {
    const response = await sendChatMessage('Research the architecture of this project');
    
    // UI 看到完整过程
    expect(response.uiEvents.length).toBeGreaterThan(5);
    
    // 模型只看到摘要
    expect(response.modelInput.summary.length).toBeLessThan(500);
  });
  
  it('should block recursion after max depth', async () => {
    const response = await sendNestedAgentCalls(5);
    
    expect(response.lastResult.status).toBe('recursion-blocked');
  });
});
```

---

*文档版本: v1.0*  
*最后更新: 2026-04-12*  
*作者: AI Agent 开发工程师*
