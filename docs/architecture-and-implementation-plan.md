# Sime-Agent 生产级架构与实施计划

> 基于 Claude Code 哲学 + AI SDK v6 原生能力的系统设计

## 目录

- [1. 设计哲学](#1-设计哲学)
- [2. 三层控制体系](#2-三层控制体系)
- [3. 模块拆分与文件结构](#3-模块拆分与文件结构)
- [4. Layer 2: Language Model Middleware 详述](#4-layer-2-language-model-middleware-详述)
- [5. Layer 1: Agent 控制层详述](#5-layer-1-agent-控制层详述)
- [6. 核心子系统详述](#6-核心子系统详述)
- [7. route.ts 变更方案](#7-routets-变更方案)
- [8. 分阶段实施路线图](#8-分阶段实施路线图)

---

## 1. 设计哲学

### 1.1 Claude Code 核心架构原则

| 原则             | 说明                                                                  | 源码对应                               |
| ---------------- | --------------------------------------------------------------------- | -------------------------------------- |
| **Agentic Loop** | `while(true)` 自主循环：思考 → 工具调用 → 执行 → 观察 → 判断是否继续  | `src/query.ts`                         |
| **工具即能力**   | 50+ 工具通过统一 `Tool<Input, Output, Progress>` 接口协同             | `src/tools.ts` → `src/Tool.ts`         |
| **权限即边界**   | 每次工具调用经过 `validateInput() → checkPermissions()` 双重检查      | `src/utils/permissions/permissions.ts` |
| **上下文即记忆** | System Prompt 动态组装 + 3 层压缩 + Token 预算 + 压缩边界             | `src/services/compact/`                |
| **流式优先**     | 所有 API 通信都是流式，AI 逐字输出 + StreamingToolExecutor 不等流结束 | `src/services/api/claude.ts`           |

### 1.2 Sime-Agent 与 Claude Code 的能力对照

| Claude Code 特性               | Sime-Agent 现状 | 实现路径                                |
| ------------------------------ | --------------- | --------------------------------------- |
| Agentic Loop (`while(true)`)   | ✅ 已实现       | `ToolLoopAgent`（AI SDK）               |
| 多层次上下文压缩（4 层）       | ✅ 已实现       | `compaction/` 13 个文件                 |
| 动态系统提示词组装             | ✅ 已实现       | `system-prompt/` Section 工厂 + 缓存    |
| Token 预算逐轮追踪             | ❌ 缺失         | LM Middleware: `cost-tracking.ts`       |
| 成本追踪（美元换算）           | ❌ 缺失         | LM Middleware: `costTrackingMiddleware` |
| Denial Tracking（防死循环）    | ❌ 缺失         | Agent 控制层: `denial-tracking.ts`      |
| Skills 技能系统                | ❌ 缺失         | `skills/` — 已规划                      |
| Sub Agent（Fork/Coordinator）  | ❌ 缺失         | AI SDK Subagent + `subagents/`          |
| MCP 协议扩展                   | ❌ 缺失         | `@ai-sdk/mcp` 原生支持                  |
| 50+ 工具生态                   | ⚠️ 仅 1 个      | 后续按需实现                            |
| 三级权限模型（Allow/Ask/Deny） | ❌ 缺失         | 后续按需实现                            |

### 1.3 为什么选择 AI SDK 原生能力而非自写循环

| AI SDK 原生机制                      | 替代 Claude Code 的什么     | 优势                                                     |
| ------------------------------------ | --------------------------- | -------------------------------------------------------- |
| `ToolLoopAgent` + `isLoopFinished()` | `query.ts` 的 `while(true)` | 无需手写流式解析、工具并行执行、错误恢复                 |
| `prepareStep`                        | 每轮迭代前的状态准备        | 可直接访问 `steps` 历史做决策                            |
| `stopWhen`                           | `query.ts` 的 7 种退出路径  | 内置安全上限（`stepCountIs`）                            |
| `wrapLanguageModel` (Middleware)     | `callModel()` 的前后拦截    | 直接操作 `transformParams`、`wrapGenerate`、`wrapStream` |
| `convertToModelMessages`             | JSONL transcript → 消息重建 | 标准化消息格式转换                                       |

---

## 2. 三层控制体系

```
用户输入
  ↓
┌──────────────────────────────────────────────────┐
│  Layer 1: Agent 层 (prepareStep + stopWhen)      │
│                                                   │
│  职责：每一步（step）级别的控制                    │
│  • 动态模型切换       • 动态工具选择              │
│  • Token 预算检查     • 终止条件判定              │
│  • 成本预算熔断       • Denial Tracking 检查注入   │
│  • Skill 动态激活     • Agent 热切换              │
│                                                  │
│  AI SDK API:                                     │
│  new ToolLoopAgent({                             │
│    prepareStep,  // 每步前执行                    │
│    stopWhen,     // 每步后检查                    │
│  })                                              │
└──────────────────────────────────────────────────┘
  ↓
┌──────────────────────────────────────────────────┐
│  Layer 1: Agent 层 (prepareStep + stopWhen)      │
│                                                   │
│  职责：每一步（step）级别的控制                    │
│  • 动态模型切换       • 动态工具选择              │
│  • Token 预算检查     • 终止条件判定              │
│  • 成本预算熔断       • Denial Tracking 检查注入   │
│  • Skill 动态激活                                 │
│                                                  │
│  AI SDK API:                                     │
│  new ToolLoopAgent({                             │
│    prepareStep,  // 每步前执行                    │
│    stopWhen,     // 每步后检查                    │
│  })                                              │
└──────────────────────────────────────────────────┘
  ↓
┌──────────────────────────────────────────────────┐
│  Layer 2: Language Model Middleware 层            │
│  (wrapLanguageModel)                             │
│                                                   │
│  职责：每次 API 调用级别的控制                     │
│  • 上下文压缩 (transformParams)                   │
│  • Token 统计 (wrapStream)                        │
│  • 成本计算 (wrapGenerate onFinish)               │
│  • 结构化日志 (wrapGenerate / wrapStream)         │
│  • Guardrails 安全过滤                            │
│                                                  │
│  AI SDK API:                                     │
│  wrapLanguageModel({                             │
│    model, middleware: [compaction, cost, log]     │
│  })                                              │
└──────────────────────────────────────────────────┘
  ↓
┌──────────────────────────────────────────────────┐
│  Layer 3: LLM Provider (真实 API 调用)            │
│                                                   │
│  @ai-sdk/openai-compatible → DashScope/Qwen       │
│  流式 HTTP 请求 + SSE 事件流                        │
└──────────────────────────────────────────────────┘
```

### 2.1 与 Claude Code 架构的对应关系

```
Claude Code                        Sime-Agent
────────────                       ──────────
QueryEngine.ts          →          Agent 层 (prepareStep + stopWhen)
  + submitMessage()                + createAgentPipeline()

query.ts (Agentic Loop)           → ToolLoopAgent (AI SDK 内置)
  + while(true)                   + isLoopFinished() / stepCountIs()

deps.callModel() 前后拦截         → LM Middleware (wrapLanguageModel)
  + compactIfNeeded               + transformParams
  + accumulateUsage               + wrapGenerate / wrapStream

src/services/compact/             → src/lib/middleware/context-compaction.ts
src/cost-tracker.ts               → src/lib/middleware/cost-tracking.ts
src/services/tokenEstimation.ts   → src/lib/session-state/token-budget.ts
```

---

## 3. 模块拆分与文件结构

```
apps/sime-agent/src/lib/
├── middleware/                    ← Layer 2: LM Middleware
│   ├── context-compaction.ts      # transformParams: 4 层压缩管线
│   ├── telemetry.ts               # wrapStream: 结构化日志 + token 统计
│   ├── cost-tracking.ts           # wrapGenerate: 成本计算 + DB 持久化
│   └── guardrails.ts              # wrapGenerate: 安全输出过滤
├── agent-control/                 ← Layer 1: Agent 控制层
│   ├── pipeline.ts                # prepareStep 管线入口
│   ├── stop-conditions.ts         # stopWhen 终止条件集合
│   ├── denial-tracking.ts         # 防 AI 死循环（注入消息 + 计数）
│   └── model-switching.ts         # 模型热切换逻辑
├── session-state/                 ← 会话状态管理（替代 QueryEngine）
│   ├── state.ts                   # SessionState 接口 + 工厂
│   ├── token-budget.ts            # Token 预算追踪
│   └── cost.ts                    # CostTracker 实现
├── skills/                        ← 技能系统（Prompt 即能力）
│   ├── types.ts                   # Frontmatter Schema (Zod)
│   ├── loader.ts                  # 磁盘扫描 + 解析器
│   ├── prompt-injection.ts        # 注入到 System Prompt
│   ├── usage-tracking.ts          # 使用频率排名（半衰算法）
│   └── section.ts                 # System-prompt 的 skills Section
├── subagents/                     ← 子 Agent 系统
│   ├── agent-tool.ts              # createAgentTool() 工厂
│   ├── presets.ts                 # Research / Coding / Review 预置
│   └── context.ts                 # 上下文管理（历史传递/隔离）
├── mcp/                           ← MCP 协议集成
│   ├── client.ts                  # MCP Client 封装
│   ├── registry.ts                # MCP Server 注册表
│   └── tool-bridge.ts             # MCP → AI SDK Tool 桥接
├── system-prompt/                 ← 已有，新增 skills section
│   ├── index.ts
│   ├── builder.ts
│   ├── types.ts
│   └── sections/
│       ├── identity.ts
│       ├── capabilities.ts
│       ├── rules.ts
│       ├── language-rules.ts
│       ├── response-style.ts
│       ├── user-preferences.ts
│       ├── project-context.ts
│       ├── system-context.ts
│       ├── session-guidance.ts
│       ├── first-message-guidance.ts
│       └── skills.ts              ← 新增
├── compaction/                    ← 已有，保持不变
│   ├── index.ts
│   ├── auto-compact.ts
│   ├── micro-compact.ts
│   ├── session-memory-compact.ts
│   ├── ptl-degradation.ts
│   ├── api-compact.ts
│   ├── background-queue.ts
│   ├── boundary.ts
│   ├── hooks.ts
│   ├── post-compact-reinject.ts
│   ├── token-counter.ts
│   └── types.ts
├── tools/                         ← 已有的工具定义
│   └── web-search.ts
└── chat-store.ts                  ← 已有，增加 cost 表
```

---

## 4. Layer 2: Language Model Middleware 详述

### 4.1 上下文压缩中间件

**目的**：在每次 `doGenerate` / `doStream` 调用前，执行消息裁剪——替代 Claude Code 的预处理管线。

```typescript
import type { LanguageModelV3Middleware } from "@ai-sdk/provider";
import type { SessionState } from "../../session-state/state";

interface ContextCompactionConfig {
  sessionState: SessionState;
}

export function contextCompactionMiddleware(
  config: ContextCompactionConfig,
): LanguageModelV3Middleware {
  return {
    transformParams: async ({ params }) => {
      const { sessionState } = config;
      const { messages } = params;

      // ① 检查 Token 预算是否超标
      if (!sessionState.tokenBudget.shouldCompact()) {
        return params; // 无需压缩，直接透传
      }

      // ② 执行压缩并更新 sessionState
      const compactionResult = await sessionState.compact(messages);
      sessionState.tokenBudget.reportCompaction(compactionResult);

      // ③ 返回裁剪后的 params.messages
      return { ...params, messages: compactionResult.compactedMessages };
    },

    wrapStream: async ({ doStream, params }) => {
      // 流式调用后，收集真实 token 用量
      const result = await doStream();

      const transformStream = new TransformStream({
        flush: async () => {
          // 流结束后，用真实 usage 更新 budget
          sessionState.tokenBudget.finalize(result);
        },
      });

      return {
        ...result,
        stream: result.stream.pipeThrough(transformStream),
      };
    },
  };
}
```

**压缩策略（复用现有 compaction 管线）**：

| 策略                       | 触发条件           | 实现                                |
| -------------------------- | ------------------ | ----------------------------------- |
| **Micro-compact**          | 工具结果超时间窗口 | `microCompact()` — 清除旧工具输出   |
| **Session Memory Compact** | 有现有 DB 摘要     | `sessionMemoryCompact()` — 无需 LLM |
| **PTL 紧急降级**           | 仍超 30K tokens    | `ptlDegradation()` — 硬截断         |
| **API 压缩**               | 兜底               | `apiCompact()` — LLM 生成摘要       |

### 4.2 成本追踪中间件

**目的**：每次 API 调用后，计算成本并累积到会话级总量。

```typescript
import type { LanguageModelV3Middleware } from '@ai-sdk/provider';
import type { SessionState } from '../../session-state/state';

// 定价数据（per 1M tokens, USD）
const PRICING: Record<string, { input?: number; output?: number; cached?: number }> = {
  'qwen-max': { input: 4, output: 12, cached: 1 },     // DeepSeek: $4/$12 per 1M
  'qwen-plus': { input: 1.5, output: 4.5, cached: 0.5 },
  'qwen-turbo': { input: 0.5, output: 1.5, cached: 0.2 },
  // 更多模型...
};

export function costTrackingMiddleware(config: {
  sessionState: SessionState;
}): LanguageModelV3Middleware {
  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();

      // 计算成本
      const usage = result.usage;
      if (usage)
        const model = params.providerMetadata?.model ?? config.sessionState.model;
        const pricing = PRICING[model] ?? {};

        const costDelta = {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cachedReadTokens: usage.cachedReadInputTokens ?? 0,
          inputCost: ((usage.inputTokens ?? 0) * (pricing.input ?? 0)) / 1_000_000,
          outputCost: ((usage.outputTokens ?? 0) * (pricing.output ?? 0)) / 1_000_000,
          totalCost: // ... 计算
        };

        config.sessionState.costTracker.accumulate(costDelta);
      }

      return result;
    },

    wrapStream: async ({ doStream, params }) => {
      const result = await doStream();

      // 流结束事件中提取 usage
      const transformStream = new TransformStream({
        flush: async () => {
          // result.usage 在流结束后累积完成
          if (result.usage) {
            // 同上计算
          }
          // 持久化到 DB
          await config.sessionState.costTracker.persistToDB();
        },
      });

      return {
        ...result,
        stream: result.stream.pipeThrough(transformStream),
      };
    },
  };
}
```

### 4.3 遥测中间件

**目的**：结构化日志记录每次 API 调用，替代 `console.log` / `console.error`。

```typescript
import type { LanguageModelV3Middleware } from "@ai-sdk/provider";

export function telemetryMiddleware(): LanguageModelV3Middleware {
  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const startTime = Date.now();
      console.log(
        `[TELE] doGenerate start | model: ${params?.providerMetadata?.model}`,
      );

      try {
        const result = await doGenerate();
        const duration = Date.now() - startTime;

        console.log(
          `[TELE] doGenerate ok | duration: ${duration}ms | output: ${(result.text ?? "").length} chars`,
        );
        return result;
      } catch (error) {
        console.error(
          `[TELE] doGenerate error | duration: ${Date.now() - startTime}ms | error: ${(error as Error).message}`,
        );
        throw error;
      }
    },
  };
}
```

### 4.4 Guardrails 中间件

**目的**：输出过滤——P II 脱敏、关键词拦截。

```typescript
import type { LanguageModelV3Middleware } from "@ai-sdk/provider";

export function guardrailsMiddleware(): LanguageModelV3Middleware {
  return {
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();

      // 示例：简单过滤
      const cleanedText = result.text?.replace(/<敏感词>/g, "[REDACTED]");

      return { ...result, text: cleanedText };
    },
  };
}
```

---

## 5. Layer 1: Agent 控制层详述

### 5.1 prepareStep 管线

`prepareStep` 在 Agent 循环的每一步之前执行，可以动态修改 model / tools / messages 等配置。

```typescript
import type {
  PrepareStepFunction,
  StopCondition,
  ToolSet,
  InferStopCondition,
} from "ai";
import type { SessionState } from "../session-state/state";
import { stepCountIs, hasToolCall, isLoopFinished } from "ai";

interface AgentPipelineConfig {
  sessionState: SessionState;
  maxSteps?: number;
  maxBudgetUsd?: number;
}

export function createAgentPipeline(config: AgentPipelineConfig): {
  prepareStep: PrepareStepFunction<any, true>;
  stopWhen: StopCondition<ToolSet>[];
} {
  const { sessionState, maxSteps = 50, maxBudgetUsd = 5.0 } = config;

  const prepareStep: PrepareStepFunction<any, true> = async ({
    stepNumber,
    messages,
    steps,
    model,
  }) => {
    // ① 累积上一步的 token 用量
    const lastStep = steps[steps.length - 1];
    if (lastStep?.usage) {
      sessionState.tokenBudget.accumulate(lastStep.usage);
    }

    // ② 检查 Denial Tracking（AI 是否反复请求同一被拒操作）
    const injectedMessage = sessionState.checkDenialTracking();
    if (injectedMessage) {
      messages.push(injectedMessage);
    }

    // ③ 检查是否需要压缩
    if (sessionState.tokenBudget.shouldCompact()) {
      const compactionResult = await sessionState.compact(messages);
      return {
        messages: compactionResult.compactedMessages,
      };
    }

    // ④ 模型热切换：用户是否在途中切换了模型？
    // （从 sessionState 或消息中提取用户意图）
    // const hotSwapResult = checkModelHotSwap(messages);
    // if (hotSwapResult.newModel) {
    //   return {
    //     model: hotSwapResult.newModelProvider,
    //   };
    // }

    return {};
  };

  const stopWhen: StopCondition<ToolSet>[] = [
    stepCountIs(maxSteps), // 安全上限：50 步
    costBudgetExceeded(sessionState, maxBudgetUsd), // 成本预算
    // denialsThresholdExceeded(sessionState),        // 死循环熔断
    hasToolCall("done"), // Agent 显式完成
  ];

  return { prepareStep, stopWhen };
}
```

### 5.2 stopWhen 终止条件详解

| 条件                       | 对应 Claude Code                 | 说明               |
| -------------------------- | -------------------------------- | ------------------ |
| `stepCountIs(50)`          | `query.ts` 的安全上限            | 防止无限循环       |
| `costBudgetExceeded`       | `QueryEngineConfig.maxBudgetUsd` | 美元预算熔断       |
| `denialsThresholdExceeded` | Denial Tracking 3 次冷却         | 防 AI 死循环       |
| `hasToolCall('done')`      | 自然退出                         | Agent 自主判断完成 |

---

## 6. 核心子系统详述

### 6.1 Session State — 会话状态管理

```typescript
// src/lib/session-state/state.ts

export interface SessionState {
  conversationId: string;
  turnCount: number; // 轮次计数

  // 追踪器
  tokenBudget: TokenBudgetTracker;
  costTracker: CostTracker;

  // 运行时
  model: string;
  activeSkills: Set<string>;
  discoveredTools: Set<string>;
  fileSnapshots: Map<string, string>; // 文件修改前快照
  denyTracking: DenialTracker;
  aborted: boolean;

  // 方法
  compact(messages: UIMessage[]): Promise<CompactionResult>;
  checkDenialTracking(): UIMessage | null;
  switchModel(newModel: string): void;
}

export function createSessionState(
  conversationId: string,
  options?: {
    maxContextTokens?: number;
    compactThreshold?: number;
    maxBudgetUsd?: number;
  },
): SessionState {
  // ... 初始化
}
```

### 6.2 Token Budget Tracker

```typescript
// src/lib/session-state/token-budget.ts

export class TokenBudgetTracker {
  private _sessionInputTokens = 0;
  private _sessionOutputTokens = 0;
  private _sessionCachedReadTokens = 0;

  constructor(
    private maxContextTokens: number = 128_000,
    private compactThreshold: number = 25_000,
  ) {}

  // 每步累积
  accumulate(usage: Usage): void {
    this._sessionInputTokens += usage.inputTokens ?? 0;
    this._sessionOutputTokens += usage.outputTokens ?? 0;
    this._sessionCachedReadTokens += usage.cachedReadInputTokens ?? 0;
  }

  // 当前已用量
  get totalTokens(): number {
    return this._sessionInputTokens + this._sessionOutputTokens;
  }

  // 是否触发压缩
  shouldCompact(): boolean {
    return (
      this._sessionInputTokens > this.maxContextTokens - this.compactThreshold
    );
  }

  // 更新压缩结果
  reportCompaction(result: CompactionResult): void {
    // 压缩后，重置或减少 token 计数
  }

  // 最终确认（流结束后用真实值更新）
  finalize(result: { usage?: Usage }): void {
    if (result.usage) {
      // 更新最后的精确值
    }
  }
}
```

### 6.3 Cost Tracker

```typescript
// src/lib/session-state/cost.ts

export interface CostDelta {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export class CostTracker {
  private _totalCost = 0;
  private _inputTokens = 0;
  private _outputTokens = 0;

  // 定价表
  private pricing: Record<
    string,
    { input: number; output: number; cached: number }
  >;

  // 累积成本
  accumulate(delta: CostDelta): void {
    this._totalCost += delta.totalCost;
    this._inputTokens += delta.inputTokens;
    this._outputTokens += delta.outputTokens;
  }

  // 持久化到 SQLite
  async persistToDB(): Promise<void> {
    // 写入 chat-store.ts 的 cost 表
  }

  // 是否超预算
  isOverBudget(maxBudgetUsd: number): boolean {
    return this._totalCost >= maxBudgetUsd;
  }

  get totalCost(): number {
    return this._totalCost;
  }
}
```

### 6.4 Denial Tracking — 防 AI 死循环

```typescript
// src/lib/agent-control/denial-tracking.ts

const DENIAL_LIMITS = {
  maxDenialsPerTool: 3,
  cooldownPeriodMs: 30_000, // 30 秒
};

export class DenialTracker {
  private _denials: Map<string, { count: number; lastTime: number }> =
    new Map();

  record(toolName: string): void {
    const existing = this._denials.get(toolName) ?? { count: 0, lastTime: 0 };
    this._denials.set(toolName, {
      count: existing.count + 1,
      lastTime: Date.now(),
    });
  }

  shouldStop(): boolean {
    for (const [toolName, data] of this._denials.entries()) {
      if (data.count >= DENIAL_LIMITS.maxDenialsPerTool) {
        // 冷却期检查
        if (Date.now() - data.lastTime < DENIAL_LIMITS.cooldownPeriodMs) {
          return true;
        }
      }
    }
    return false;
  }

  injectMessage(): UIMessage | null {
    if (!this.shouldStop()) return null;

    return {
      role: "system" as const,
      content: "⚠️ 你多次尝试的操作被拒绝，请换用其他方法。",
    };
  }
}
```

### 6.5 Skills —— 技能系统

#### 6.5.1 SKILL.md 格式

```markdown
---
name: code-review
description: 系统性代码审查，检查安全性、性能、可维护性
whenToUse: "用户要求审查代码、找 bug、找安全隐患"
allowedTools:
  - Read
  - Grep
  - Glob
model: opus
effort: high
context: inline
paths:
  - "src/**/*.ts"
---

## 代码审查流程

1. 先用 Glob 找到 .ts 文件
2. 用 Read 读取关键文件
3. 按以下清单审查：
   - 安全问题（XSS、注入、硬编码密钥）
   - 性能问题（N+1、重复查询、内存泄漏）
   - 代码质量（命名、注释、DRY）
4. 输出结构化报告
```

#### 6.5.2 加载器

```typescript
// src/lib/skills/loader.ts

import { parseFrontmatter } from "gray-matter";

export async function loadSkill(skillPath: string): Promise<Skill> {
  const content = await fs.readFile(skillPath, "utf-8");
  const { data, content: body } = parseFrontmatter(content);

  return {
    name: data.name,
    description: data.description,
    whenToUse: data.whenToUse,
    allowedTools: data.allowedTools ?? [],
    model: data.model,
    paths: data.paths ?? [],
    inlineOrFork: data.context ?? "inline",
    body,
  };
}

export async function scanSkillsDirs(): Promise<Skill[]> {
  const dirs = [
    ".claude/skills/",
    "skills/",
    // 更多...
  ];

  const skills: Skill[] = [];
  for (const dir of dirs) {
    // 扫描所有 SKILL.md 文件
  }

  return skills;
}
```

#### 6.5.3 Prompt 注入

```typescript
// src/lib/skills/prompt-injection.ts

export function injectSkillsIntoPrompt(
  systemPrompt: string,
  skills: Skill[],
  activeSkills: Set<string>,
): string {
  const active = skills.filter((s) => activeSkills.has(s.name));

  if (active.length === 0) return systemPrompt;

  const skillsList = active
    .map(
      (s) =>
        `- **${s.name}**: ${s.description}\n  触发: ${s.whenToUse}\n  可用工具: ${s.allowedTools.join(", ")}`,
    )
    .join("\n\n");

  return `${systemPrompt}\n\n## 可用技能\n${skillsList}`;
}
```

### 6.6 Subagents —— 子 Agent 系统

#### 6.6.1 Agent Tool 工厂

```typescript
// src/lib/subagents/agent-tool.ts
import { tool, ToolLoopAgent, readUIMessageStream, isLoopFinished } from "ai";
import { z } from "zod";

interface AgentToolConfig {
  name: string;
  instructions: string;
  model?: string;
  tools: Record<string, Tool>;
  stopWhen?: StopCondition;
}

export function createAgentTool(config: AgentToolConfig) {
  return tool({
    description: config.instructions.slice(0, 200),
    inputSchema: z.object({
      task: z.string().describe("要完成的子任务描述"),
    }),
    execute: async function* ({ task }, { abortSignal }) {
      const subagent = new ToolLoopAgent({
        model: config.model ?? mainModel,
        instructions: config.instructions,
        tools: config.tools,
        stopWhen: config.stopWhen ?? isLoopFinished(),
      });

      const result = await subagent.stream({
        prompt: task,
        abortSignal,
      });

      for await (const message of readUIMessageStream({
        stream: result.toUIMessageStream(),
      })) {
        yield message;
      }
    },
    toModelOutput: ({ output }) => {
      // 主 Agent 只看摘要
      const lastTextPart = output?.parts.findLast((p) => p.type === "text");
      return { type: "text", value: lastTextPart?.text ?? "Task completed." };
    },
  });
}
```

#### 6.6.2 预置 Agent

```typescript
// src/lib/subagents/presets.ts

export const researchAgent = createAgentTool({
  name: "research",
  instructions:
    "你是一个只读研究 Agent。用提供的工具探索代码库，然后返回结构化摘要。",
  tools: { web_search, grep, glob, read, web_fetch },
});

export const codingAgent = createAgentTool({
  name: "coding",
  instructions: "你是一个编码 Agent。你可以读取、写入和编辑文件。",
  tools: { read, write, edit, bash },
});

export const reviewAgent = createAgentTool({
  name: "review",
  instructions: "你是一个代码审查 Agent。",
  tools: { read, grep, glob, code_review_skill },
});
```

### 6.7 MCP 集成

```typescript
// src/lib/mcp/client.ts
import { createMcpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectMcpServer(config: McpServerConfig) {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
  });

  const client = createMcpClient(transport);
  await client.connect();

  const tools = await client.tools();
  return { client, tools };
}
```

---

## 7. route.ts 变更方案

### 当前代码

```typescript
export async function POST(request: NextRequest) {
  const { messages } = await request.json();
  const conversationId = String(
    request.headers.get("X-Conversation-ID"),
  ).replace(/[^a-zA-Z0-9-]/g, "");

  const existingConversation = await loadOrCreateConversation(conversationId);
  const compactedMessages = await compactMessagesIfNeeded(
    messages,
    conversationId,
  );

  const conversationMeta = {
    id: conversationId,
    title: existingConversation.title ?? null,
    createdAt: new Date(existingConversation.created_at),
    updatedAt: new Date(existingConversation.updated_at),
  };

  const chatAgent = await createChatAgent({ conversationMeta });
  return createAgentUIStreamResponse({
    agent: chatAgent,
    uiMessages: compactedMessages,
    maxSteps: 50,
    onFinish: async ({ messages: completedMessages }) => {
      await runCompactInBackground(messagesToSave, conversationId);
    },
  });
}
```

### 变更后的代码

```typescript
// src/app/api/chat/route.ts

export async function POST(request: NextRequest) {
  const { messages } = await request.json();
  const conversationId = String(
    request.headers.get("X-Conversation-ID"),
  ).replace(/[^a-zA-Z0-9-]/g, "");

  const existingConversation = await loadOrCreateConversation(conversationId);
  const compactedMessages = await compactMessagesIfNeeded(
    messages,
    conversationId,
  );

  // ========== 1. 创建会话状态 ==========
  const sessionState = createSessionState(conversationId, {
    maxContextTokens: 128_000,
    compactThreshold: 25_000,
    maxBudgetUsd: 5.0,
  });

  // ========== 2. 包装模型（Middleware 层）==========
  const wrappedModel = wrapLanguageModel({
    model: dashscope(process.env.DASHSCOPE_MODEL!),
    middleware: [
      contextCompactionMiddleware({ sessionState }),
      costTrackingMiddleware({ sessionState }),
      telemetryMiddleware(),
    ],
  });

  // ========== 3. 构建 Agent 控制层 ==========
  const { prepareStep, stopWhen } = createAgentPipeline(sessionState, {
    maxSteps: 50,
    maxBudgetUsd: 5.0,
  });

  // ========== 4. 加载 Skills ==========
  const availableSkills = await scanSkillsDirs();
  const activeSkills = await determineActiveSkills(availableSkills);
  sessionState.skills = activeSkills;

  // ========== 5. 加载 MCP 工具（可选）==========
  // const mcpTools = await loadMcpTools();

  // ========== 6. 创建 Agent ==========
  const chatAgent = new ToolLoopAgent({
    model: wrappedModel,
    instructions: await buildSystemPrompt({
      conversationMeta: {
        id: conversationId,
        title: existingConversation.title ?? null,
        createdAt: new Date(existingConversation.created_at),
        updatedAt: new Date(existingConversation.updated_at),
      },
      skills: activeSkills,
    }),
    tools: {
      web_search: exaSearchTool,
      research: researchAgent,
      code_review: reviewAgent,
    },
    prepareStep,
    stopWhen,
    toolChoice: "auto",
  });

  // ========== 7. 流式响应 ==========
  return createAgentUIStreamResponse({
    agent: chatAgent,
    uiMessages: compactedMessages,
    maxSteps: 50,
    onFinish: async ({ messages: completedMessages, usage }) => {
      const messagesToSave: NewMessage[] = completedMessages
        .slice(compactedMessages.length)
        .map((message, index) => ({
          id: nanoid(),
          conversation_id: conversationId,
          role: message.role,
          content: JSON.stringify(message.content),
          order_index: compactedMessages.length + index,
        }));

      await saveMessages(conversationId, messagesToSave);
      await sessionState.costTracker.persistToDB();
      runCompactInBackground(messagesToSave, conversationId);
    },
  });
}
```

---

## 8. 分阶段实施路线图

### Phase 1: 循环中间件 — 基础（2-3 天）

```
✅ 已有的 compaction 系统不动
→ session-state/state.ts           # SessionState 接口 + 工厂
→ session-state/token-budget.ts    # Token 预算追踪
→ middleware/telemetry.ts          # 结构化日志 + 用量统计
→ agent-control/pipeline.ts        # prepareStep 基础版
→ agent-control/stop-conditions.ts # stopWhen 条件（stepCountIs + cost）
→ route.ts 变更 # 包装模型 + prepareStep + stopWhen
```

**验证**：Agent 可以在 50 步内自主循环，Token 和成本正确记录到 DB。

### Phase 2: 成本追踪 + 预算管理（1-2 天）

```
→ session-state/cost.ts            # CostTracker 实现
→ middleware/cost-tracking.ts      # LM Middleware 实现
→ middleware/guardrails.ts         # Guardrails
→ route.ts 变更 # 加入 costTrackingMiddleware
```

**验证**：每次 API 调用后成本正确累加，预算超限后 Agent 停止。

### Phase 3: Skills 技能系统（2-3 天）

```
→ skills/types.ts                  # Frontmatter Schema
→ skills/loader.ts                 # 磁盘扫描 + frontmatter 解析
→ skills/prompt-injection.ts       # 注入到 System Prompt
→ skills/usage-tracking.ts         # 半衰排名算法
→ system-prompt/sections/skills.ts # New Section
```

**验证**：Skill 按目录加载，Prompt 注入正确。

### Phase 4: Denial Tracking + 模型热切换（1 天）

```
→ agent-control/denial-tracking.ts # 死循环防护
→ agent-control/model-switching.ts # 热切换
→ agent-control/pipeline.ts        变更 # 加入 denial check + hot-swap
```

**验证**：AI 反复请求同一被拒操作时，系统自动注入引导消息。

### Phase 5: Sub agents（2-3 天）

```
→ subagents/agent-tool.ts          # createAgentTool() 工厂
→ subagents/presets.ts             # Research / Coding / Review 预置
→ subagents/context.ts             # 上下文隔离逻辑
→ route.ts 变更 # 加入子 Agent 工具
```

**验证**：子 Agent 可以独立执行并返回摘要，主 Agent 上下文不受污染。

### Phase 6: MCP 集成（1-2 天）

```
→ mcp/client.ts                    # MCP Client 封装
→ mcp/registry.ts                  # Server 注册表
→ mcp/tool-bridge.ts               # MCP → AI SDK Tool 桥接
→ route.ts 变更 # 加入 MCP 工具到 Agent tools
```

**验证**：MCP Server 连接成功，工具在 Agent 中可用。

### Phase 7: 工具生态（按需）

```
→ tools/read.ts                    # 文件读取
→ tools/write.ts                   # 文件写入
→ tools/edit.ts                    # diff 编辑
→ tools/bash.ts                    # 沙箱命令执行
→ tools/grep.ts                    # 代码搜索
→ tools/glob.ts                    # 文件匹配
```

### 关键依赖关系

```
Phase 1 ──→ Phase 2 ──→ Phase 4
                          ↓
Phase 3: Skills 独立于 1-2-4，但 Phase 5 依赖它
                          ↓
Phase 5: Subagents 依赖 Phase 1, 3
                          ↓
Phase 6: MCP 依赖 Phase 1
                          ↓
Phase 7: 工具实现与 1-6 平行
```
