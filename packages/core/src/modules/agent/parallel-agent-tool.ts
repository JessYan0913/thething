// ============================================================
// Parallel Agent Tool - 并行执行多个子 Agent
// ============================================================

import { tool } from 'ai';
import { z } from 'zod';
import { AgentRegistry } from './registry';
import { resolveAgentRoute } from './router';
import { executeRoutedAgent } from './executor';
import { isSubstantiveDeliverable } from './deliverable';
import { resolveTodoReference } from '../todos';
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
// Types
// ============================================================

interface ParallelTaskInput {
  /** Agent 类型（可选，LLM 自主选择；留空走通用执行） */
  agentType?: string;
  /** 任务描述 */
  task: string;
  /** 标签（用于结果标识） */
  label?: string;
  /** 关联的任务引用（可选，子 Agent 完成后自动更新该 todo 状态）：编号 [#N] 或精确标题 */
  todo?: string;
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
            .describe('Agent type (optional). Choose EXPLICITLY per task by capability; the system does NOT auto-route. Leave blank only for general-purpose execution.'),
          task: z.string().min(1).describe('Task description for this sub-agent'),
          label: z.string().optional().describe('Label for result identification'),
          todo: z.string().optional().describe(
            'Reference to the todo this task corresponds to: its list index like [#3], or its exact title. Resolves to in_progress on start and completed/failed on finish.'
          ),
        })
      )
      .min(2)
      .max(MAX_PARALLEL_AGENTS)
      .describe(
        `Array of tasks to run in parallel (2-${MAX_PARALLEL_AGENTS}). ` +
          'Each task runs independently with its own sub-agent.'
      ),
  });

  // 能力边界自动推导（与 agent-tool 保持一致）：写文件看 write_file/edit_file/bash，web_fetch 单列
  const deriveCapability = (tools: string[] | undefined): string => {
    const canWrite = tools?.some((t) => ['write_file', 'edit_file', 'bash'].includes(t)) ?? false;
    const hasWeb = tools?.includes('web_fetch') ?? false;
    if (canWrite) return hasWeb ? '可写文件（全工具）' : '可写文件';
    return hasWeb ? '只读 + web' : '只读';
  };

  // 生成 agent 列表描述（只列出可自动委派子Agent，与 agent-tool 一致）
  const registeredAgents = agentRegistry.getAll();
  const delegatableAgents = registeredAgents.filter((a) => {
    const metadata = a.metadata as Record<string, unknown> | undefined;
    return metadata?.isSubAgentAvailable === true;
  });
  const agentList = delegatableAgents.length > 0
    ? delegatableAgents
        .map((a) => {
          const sourceTag = a.source === 'builtin' ? '' : ` (${a.source})`;
          const brief = a.instructions.split('\n')[0]?.slice(0, 80) ?? '';
          const tools = a.tools?.length ? a.tools.join(', ') : '（无工具）';
          return `- **${a.agentType}**${sourceTag}: ${brief}\n  工具：${tools} | 能力：${deriveCapability(a.tools)}`;
        })
        .join('\n')
    : '（当前无可自动委派子Agent）';

  return tool({
    description: `Run multiple sub-agents in PARALLEL to handle independent tasks simultaneously.

Use this when you need to:
- Research a topic from multiple angles at once
- Investigate several questions simultaneously
- Analyze different aspects of a problem concurrently

IMPORTANT: Tasks must be INDEPENDENT. Check the todos list: if any of these tasks have 'blockedBy' or 'depends on' dependencies, they are NOT independent and must be executed sequentially using the regular 'agent' tool.

Choose agentType EXPLICITLY for each task by capability — the system does NOT auto-route.

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

      // 执行防护（设计 §1.3 执行防护层）：有 blockedBy 依赖的任务不能并行执行——
      // 命中即返回失败 + 降级指导，系统不执行模型的错误并行决策。
      const todoStore = config.todoStore;
      if (todoStore && config.conversationId) {
        const blockedTasks = tasks
          .map(
            (t) =>
              t.todo && config.conversationId
                ? todoStore.getTodo(resolveTodoReference(todoStore, config.conversationId, t.todo) ?? '')
                : undefined
          )
          .filter((t): t is NonNullable<typeof t> => !!t && t.blockedBy.length > 0);
        if (blockedTasks.length > 0) {
          return {
            success: false,
            summary: `以下任务存在依赖，无法并行执行：${blockedTasks.map((t) => t.subject).join('、')}。请使用 agent 工具按顺序执行。`,
            durationMs: Date.now() - startTime,
            results: [],
            status: 'failed' as const,
          };
        }
      }

      // 嵌套防护说明：一层子 Agent 由结构保证——resolveToolsForAgent
      // 无条件剔除 agent/parallel_agent，子 Agent 无法再派生。

      // 可观测：并行 agent 调用计数 + 带 todoId 的任务占比（路径 B 影响评估）
      logger.info(
        'ParallelAgent',
        `[invoke] tasks=${tasks.length} withTodo=${tasks.filter((t) => t.todo).length}`
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
      // 设计决策（A2，2026-08-18）：并行执行未返回可读 summary 时，不注入
      // "Parallel tasks completed." 假话——如实透传空态，让调用方能区分完成与无结论。
      return { type: 'text' as const, value: '(并行子Agent 未返回结论文本)' };
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
      connectorToolNames: config.connectorToolNames,
      parentModel: config.parentModel,
      parentSystemPrompt: config.parentSystemPrompt,
      parentMessages: config.parentMessages,
      writerRef: config.writerRef,
      abortSignal: abortSignal ?? new AbortController().signal,
      toolCallId: taskToolCallId,
      todoStore: config.todoStore,
      scheduler: config.scheduler,
      executionMode: 'parallel_agent',
      // 模型面用编号/标题引用 → 解析为内部 todo id（Path B 状态同步）；无引用或解析不到则回落父 id
      todoId:
        taskInput.todo && config.todoStore && config.conversationId
          ? resolveTodoReference(config.todoStore, config.conversationId, taskInput.todo)
          : (config.todoId ?? undefined),
      provider: config.provider,
      modelAliases: config.modelAliases,
      cwd,
      agentRegistry,
      compactionConfig: config.compactionConfig,
      maxTotalTokens: config.maxTotalTokens,
      maxOutputTokens: config.maxOutputTokens,
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

    // P0 交付物校验（§1.3 待设计对齐）：该任务成功但无实质交付物 → 视为该任务失败，
    // 保持部分失败隔离（不影响并行批次其他任务）；buildParallelSummary 会列入失败组，
    // 主Agent 据此决定重委派或透明说明。
    if (result.success && !isSubstantiveDeliverable(result.summary)) {
      return {
        label: taskLabel,
        agentType: routeDecision.definition.agentType,
        result: {
          success: false,
          summary: `子Agent 未返回实质交付物（只有过程日志或空结果）`,
          durationMs: result.durationMs,
          stepsExecuted: result.stepsExecuted,
          toolsUsed: result.toolsUsed,
          error: 'no deliverable',
          status: 'failed',
        },
      };
    }

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
