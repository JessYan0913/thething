// ============================================================
// Parallel Agent Tool - 并行执行多个子 Agent
// ============================================================

import { tool } from 'ai';
import { z } from 'zod';
import { AgentRegistry } from './registry';
import { resolveAgentRoute } from './router';
import { executeRoutedAgent } from './executor';
import { checkRecursionGuard, RecursionTracker } from './recursion-guard';
import { logger } from '../../primitives/logger';
import type {
  AgentToolConfig,
  AgentExecutionContext,
  AgentExecutionResult,
} from './types';

// ============================================================
// Constants
// ============================================================

/** 并行 Agent 最大数量 */
const MAX_PARALLEL_AGENTS = 8;

/** 并行 Agent 默认数量 */
const DEFAULT_PARALLEL_AGENTS = 5;

// ============================================================
// Recursion Tracker（复用单 agent 的 tracker）
// ============================================================

const tracker = new RecursionTracker();

// ============================================================
// Types
// ============================================================

interface ParallelTaskInput {
  /** Agent 类型（可选，自动路由） */
  agentType?: string;
  /** 任务描述 */
  task: string;
  /** 标签（用于结果标识） */
  label?: string;
}

interface ParallelAgentResult {
  /** 任务标签 */
  label: string;
  /** Agent 类型（实际使用的） */
  agentType: string;
  /** 执行结果 */
  result: AgentExecutionResult;
}

// ============================================================
// Parallel Agent Tool Factory
// ============================================================

/**
 * 创建并行 Agent 工具
 *
 * 同时派出多个子 Agent 执行不同任务，收集所有结果。
 * 适用于研究、多角度分析等需要并行调查的场景。
 *
 * @param config Agent 工具配置（与 createAgentTool 共享）
 * @returns Tool 对象
 */
export function createParallelAgentTool(config: AgentToolConfig) {
  const cwd = config.cwd ?? process.cwd();
  const agentRegistry = config.agentRegistry ?? new AgentRegistry();
  for (const agent of config.agents ?? []) {
    if (!agentRegistry.has(agent.agentType)) {
      agentRegistry.register(agent);
    }
  }

  const ParallelAgentInputSchema = z.object({
    tasks: z
      .array(
        z.object({
          agentType: z
            .string()
            .optional()
            .describe('Agent type (optional, auto-routes by task keywords)'),
          task: z.string().min(1).describe('Task description for this sub-agent'),
          label: z.string().optional().describe('Label for result identification'),
        })
      )
      .min(2)
      .max(MAX_PARALLEL_AGENTS)
      .describe(
        `Array of tasks to run in parallel (2-${MAX_PARALLEL_AGENTS}). ` +
          'Each task runs independently with its own sub-agent.'
      ),
  });

  // 生成 agent 列表描述
  const registeredAgents = agentRegistry.getAll();
  const agentList = registeredAgents
    .map((a) => {
      const sourceTag = a.source === 'builtin' ? '' : ` (${a.source})`;
      const brief = a.instructions.split('\n')[0]?.slice(0, 80) ?? '';
      return `- **${a.agentType}**${sourceTag}: ${brief}`;
    })
    .join('\n');

  return tool({
    description: `Run multiple sub-agents in PARALLEL to handle independent tasks simultaneously.

Use this when you need to:
- Research a topic from multiple angles at once
- Investigate several questions simultaneously
- Analyze different aspects of a problem concurrently

IMPORTANT: Tasks must be INDEPENDENT. If tasks depend on each other, use the regular 'agent' tool sequentially.

Available agents:
${agentList}

Each task gets its own sub-agent. All agents run at the same time (not sequentially).
Results are collected and returned together with labels for easy identification.`,
    inputSchema: ParallelAgentInputSchema,

    execute: async (
      { tasks }: { tasks: ParallelTaskInput[] },
      options
    ) => {
      const startTime = Date.now();
      const parentToolCallId = options.toolCallId ?? `parallel-${Date.now()}`;
      const abortSignal = options.abortSignal;
      const writer = config.writerRef?.current ?? null;
      const depth = config.recursionDepth ?? 0;

      // 输入校验（防御性，Zod 校验可能在某些调用路径下被跳过）
      if (!Array.isArray(tasks) || tasks.length < 2) {
        return {
          success: false,
          summary: 'At least 2 tasks are required for parallel execution',
          durationMs: Date.now() - startTime,
          results: [],
          status: 'failed' as const,
        };
      }
      if (tasks.length > MAX_PARALLEL_AGENTS) {
        return {
          success: false,
          summary: `Maximum ${MAX_PARALLEL_AGENTS} parallel agents allowed, got ${tasks.length}`,
          durationMs: Date.now() - startTime,
          results: [],
          status: 'failed' as const,
        };
      }

      // 递归检查
      if (checkRecursionGuard({ recursionDepth: depth })) {
        return {
          success: false,
          summary: 'Parallel execution blocked: maximum recursion depth exceeded',
          durationMs: Date.now() - startTime,
          results: [],
          status: 'recursion-blocked' as const,
        };
      }

      // 注册所有并行任务
      for (const task of tasks) {
        tracker.enter(parentToolCallId);
      }

      logger.info(
        'ParallelAgent',
        `Starting ${tasks.length} parallel agents | Depth: ${depth}`
      );

      // 广播并行开始事件
      writer?.write({
        type: 'data-sub-open',
        id: parentToolCallId,
        data: {
          mode: 'parallel',
          taskCount: tasks.length,
          tasks: tasks.map((t, i) => ({
            label: t.label ?? `task-${i}`,
            agentType: t.agentType ?? 'auto',
            task: t.task,
          })),
        },
      });

      // 构建所有并行任务的 Promise
      const taskPromises = tasks.map((taskInput, index) => {
        const taskLabel = taskInput.label ?? `task-${index}`;
        const taskToolCallId = `${parentToolCallId}-${index}`;

        return executeSingleTask({
          taskInput,
          taskLabel,
          taskToolCallId,
          config,
          cwd,
          agentRegistry,
          depth,
          abortSignal,
          writer,
        });
      });

      // 并行执行所有任务
      const settledResults = await Promise.allSettled(taskPromises);

      // 汇总结果
      const results: ParallelAgentResult[] = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < settledResults.length; i++) {
        const settled = settledResults[i];
        const taskLabel = tasks[i].label ?? `task-${i}`;

        if (settled.status === 'fulfilled') {
          results.push(settled.value);
          if (settled.value.result.success) {
            successCount++;
          } else {
            failCount++;
          }
        } else {
          failCount++;
          results.push({
            label: taskLabel,
            agentType: tasks[i].agentType ?? 'auto',
            result: {
              success: false,
              summary: `Task failed: ${settled.reason}`,
              durationMs: Date.now() - startTime,
              stepsExecuted: 0,
              toolsUsed: [],
              error: String(settled.reason),
              status: 'failed',
            },
          });
        }
      }

      // 释放递归追踪
      for (const _task of tasks) {
        tracker.exit(parentToolCallId);
      }

      const totalDuration = Date.now() - startTime;

      // 汇总摘要
      const summary = buildParallelSummary(results, totalDuration);

      logger.info(
        'ParallelAgent',
        `Completed: ${successCount} succeeded, ${failCount} failed | ${totalDuration}ms`
      );

      // 广播完成事件
      writer?.write({
        type: 'data-sub-done',
        id: parentToolCallId,
        data: {
          success: failCount === 0,
          mode: 'parallel',
          taskCount: tasks.length,
          successCount,
          failCount,
          durationMs: totalDuration,
        },
      });

      return {
        success: failCount === 0,
        summary,
        durationMs: totalDuration,
        results,
        status: failCount === 0 ? ('completed' as const) : ('failed' as const),
      };
    },

    toModelOutput: ({ output }) => {
      if (output && typeof output === 'object' && 'summary' in output) {
        return { type: 'text' as const, value: output.summary as string };
      }
      return { type: 'text' as const, value: 'Parallel tasks completed.' };
    },
  });
}

// ============================================================
// Single Task Executor
// ============================================================

interface ExecuteSingleTaskOptions {
  taskInput: ParallelTaskInput;
  taskLabel: string;
  taskToolCallId: string;
  config: AgentToolConfig;
  cwd: string;
  agentRegistry: AgentRegistry;
  depth: number;
  abortSignal?: AbortSignal;
  writer: { write: (chunk: Record<string, unknown>) => void } | null;
}

/**
 * 执行单个并行任务
 */
async function executeSingleTask(
  options: ExecuteSingleTaskOptions
): Promise<ParallelAgentResult> {
  const {
    taskInput,
    taskLabel,
    taskToolCallId,
    config,
    cwd,
    agentRegistry,
    depth,
    abortSignal,
    writer,
  } = options;

  const taskStartTime = Date.now();

  try {
    // 广播单个任务开始
    writer?.write({
      type: 'data-sub-progress',
      id: taskToolCallId,
      data: {
        label: taskLabel,
        status: 'starting',
        agentType: taskInput.agentType ?? 'auto',
      },
    });

    // 构建执行上下文（并行任务共享父上下文，但有独立的 toolCallId）
    const context: AgentExecutionContext = {
      parentTools: config.parentTools,
      parentModel: config.parentModel,
      parentSystemPrompt: config.parentSystemPrompt,
      parentMessages: config.parentMessages,
      writerRef: config.writerRef,
      abortSignal: abortSignal ?? new AbortController().signal,
      toolCallId: taskToolCallId,
      recursionDepth: depth + 1, // 并行任务在下一层
      todoStore: config.todoStore,
      todoId: config.todoId,
      provider: config.provider,
      modelAliases: config.modelAliases,
      cwd,
      agentRegistry,
    };

    // 路由决策
    const routeDecision = resolveAgentRoute(
      { agentType: taskInput.agentType, task: taskInput.task },
      context
    );

    logger.debug(
      'ParallelAgent',
      `[${taskLabel}] Routing to ${routeDecision.definition.agentType} | ${routeDecision.reason}`
    );

    // 执行 Agent
    const result = await executeRoutedAgent(
      routeDecision.definition,
      context,
      taskInput.task
    );

    return {
      label: taskLabel,
      agentType: routeDecision.definition.agentType,
      result,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    return {
      label: taskLabel,
      agentType: taskInput.agentType ?? 'auto',
      result: {
        success: false,
        summary: `Task failed: ${errorMsg}`,
        durationMs: Date.now() - taskStartTime,
        stepsExecuted: 0,
        toolsUsed: [],
        error: errorMsg,
        status: 'failed',
      },
    };
  }
}

// ============================================================
// Summary Builder
// ============================================================

/**
 * 构建并行执行的汇总摘要
 */
function buildParallelSummary(
  results: ParallelAgentResult[],
  totalDuration: number
): string {
  const succeeded = results.filter((r) => r.result.success);
  const failed = results.filter((r) => !r.result.success);

  const lines: string[] = [];

  lines.push(
    `## Parallel Execution: ${succeeded.length}/${results.length} tasks succeeded (${totalDuration}ms)`
  );
  lines.push('');

  // 成功的任务
  if (succeeded.length > 0) {
    lines.push('### ✅ Succeeded');
    for (const r of succeeded) {
      lines.push(`\n#### [${r.label}] (${r.agentType}, ${r.result.durationMs}ms)`);
      lines.push(r.result.summary);
    }
  }

  // 失败的任务
  if (failed.length > 0) {
    lines.push('');
    lines.push('### ❌ Failed');
    for (const r of failed) {
      lines.push(
        `\n#### [${r.label}] (${r.agentType}) - ${r.result.error ?? 'Unknown error'}`
      );
    }
  }

  return lines.join('\n');
}
