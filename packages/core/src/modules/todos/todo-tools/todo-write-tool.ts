import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore, TodoStatus, Todo } from '../types';
import { logger } from '../../../primitives/logger';

/**
 * TodoWriteTool - 任务清单管理（主入口，Claude Code TodoWrite 风格）
 *
 * 一次调用可创建/更新多个任务：
 * - 带 id 且存在 → 更新（subject/status/activeForm/metadata）
 * - 不带 id（或 id 不存在）→ 新建
 * - 未列出的活跃任务 → 保留（鲁棒语义：不静默删除，避免模型"只传当前项"
 *   的滚动窗口导致未列出的待办丢失）；取消某项请显式传 status: 'cancelled'
 * - 已完成的 todo 自动保留（作为"已做过什么"的参考，供 overview 展示）
 *
 * 相比细粒度工具，规划和推进的调用成本接近于零，适合主 Agent 单线程推进。
 * 依赖图（blockedBy）走 todo_create_batch。
 */

const TodoWriteItemSchema = z.object({
  /** 已有任务的 ID（更新时传，新建时省略） */
  id: z.string().optional().describe('Existing todo ID (omit for new todos)'),
  /** 任务标题（祈使句） */
  subject: z.string().min(1).describe('Task title in imperative form'),
  /** 任务状态 */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
    .describe('Task status'),
  /** 进行中时的现在进行时描述 */
  activeForm: z.string().optional()
    .describe('Present-tense label shown while in_progress (e.g. "Running tests")'),
  /** 完成标准（可执行的验证方式） */
  verify: z.string().optional()
    .describe('How to verify this task is done — an executable check where possible (e.g. "npx vitest run src/utils passes"). Defining it upfront turns "done" into "verified".'),
  /** 完成时的结论 */
  result: z.string().optional()
    .describe('When marking completed: one line on what was done and how it was verified. Later steps and sub-agents rely on this instead of conversation memory.'),
  /** 失败原因 */
  error: z.string().optional()
    .describe('When marking failed: why it failed, so the plan can be revised instead of silently stalling.'),
});

export const todoWriteToolSchema = z.object({
  /** 完整任务列表（整表替换语义） */
  todos: z.array(TodoWriteItemSchema).max(20)
    .describe('The FULL todo list. Replaces the current list: existing todos not included here are removed.'),
});

export type TodoWriteToolInput = z.infer<typeof todoWriteToolSchema>;

export type TodoWriteToolOutput = {
  success: true;
  todos: Array<{ id: string; subject: string; status: TodoStatus }>;
  message?: string;
} | {
  success: false;
  error: string;
};

/** 子任务独立上下文范式：仅 completed 视为子任务完结，触发 prepareStep 边界重建（failed 不触发归档） */
function notifyTodoCompleted(
  opts: { onTodoCompleted?: (id: string) => void } | undefined,
  id: string,
  status: TodoStatus,
): void {
  if (status === 'completed' && opts?.onTodoCompleted) {
    opts.onTodoCompleted(id);
  }
}

/**
 * 确定性的规划质量检查（lint 式返回值反馈，不阻断执行）。
 * 放在返回值里比写进系统提示词有效：模型必读工具结果，且对弱模型同样生效。
 */
function collectPlanWarnings(todos: TodoWriteToolInput['todos']): string[] {
  const warnings: string[] = [];

  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;
  if (inProgressCount > 1) {
    warnings.push(`${inProgressCount} todos are in_progress. Keep exactly one in_progress at a time.`);
  }

  for (const t of todos) {
    if (t.status === 'completed' && !t.result) {
      warnings.push(`"${t.subject}" marked completed without a result. Record what was done and how it was verified.`);
    }
    if (t.status === 'failed' && !t.error) {
      warnings.push(`"${t.subject}" marked failed without an error. Record why, so the plan can be revised.`);
    }
  }

  return warnings;
}

/** 是否为本调用中真实发生的 completed/failed 跃迁（排除全表重传时已完成的项） */
function isCompletionTransition(
  item: TodoWriteToolInput['todos'][number],
  existingById: Map<string, Todo>,
): boolean {
  if (item.status !== 'completed' && item.status !== 'failed') return false;
  if (!item.id || !existingById.has(item.id)) return true; // 新建即完成/失败
  const prev = existingById.get(item.id)!;
  return prev.status !== 'completed' && prev.status !== 'failed'; // 状态跃迁到完成/失败
}

/**
 * 单完成约束（设计裁决）：一次调用只能将一个新 todo 标记为 completed/failed。
 * 违反时返回错误（而非静默覆盖），防止多个 todo 同时完成导致
 * pendingArchiveTodoId 单字段覆盖、其余子任务丢失归档。
 */
function validateSingleCompletion(
  items: TodoWriteToolInput['todos'],
  existingById: Map<string, Todo>,
): string | null {
  const transitions = items.filter((item) => isCompletionTransition(item, existingById));
  if (transitions.length > 1) {
    return `一次只能将一个 todo 标记为 completed/failed，本次标记了 ${transitions.length} 个（${transitions.map((t) => t.subject).join('、')}）。请分多次调用 todo_write。`;
  }
  return null;
}

/**
 * 从工具入参提取 metadata 增量（只包含显式提供的字段，避免覆盖已有值）。
 */
function itemMetadata(item: TodoWriteToolInput['todos'][number]): Record<string, string> | undefined {
  const meta: Record<string, string> = {};
  if (item.verify !== undefined) meta.verify = item.verify;
  if (item.result !== undefined) meta.result = item.result;
  if (item.error !== undefined) meta.error = item.error;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Create a TodoWriteTool bound to a conversation
 *
 * @param store - The todo store
 * @param conversationId - The conversation ID to associate todos with
 * @param opts - 可选回调；onTodoCompleted 在子任务标记 completed/failed 时触发（子任务独立上下文范式：prepareStep 据此重建上下文）
 * @returns The tool definition
 */
export function createTodoWriteToolForConversation(
  store: TodoStore,
  conversationId: string,
  opts?: { onTodoCompleted?: (todoId: string) => void },
) {
  return tool({
    description: `Create and update the task list for the current session. The PREFERRED tool for task planning — use it to decompose complex work.

When the user's request is complex — a problem that benefits from being split into a few sub-tasks you think through and execute one by one (multiple facets, trade-offs, uncertainty, exploration, iteration), e.g. plan a trip with itinerary + budget + packing list; research a topic + write a report + list key companies; weigh two options and decide — your FIRST action should be calling this tool to lay out the plan — do not start working before the list exists. Judge by the mental complexity of the problem, not by how many mechanical steps it will take. Only high-stakes or user-requested-confirmation work should use submit_plan instead; everything else plans with this tool.

Usage:
- Pass the FULL list each call to keep it accurate. Omitted items are KEPT — the tool never silently deletes; to cancel a task, pass it with status "cancelled".
- Include the \`id\` for todos you are updating; omit it for new todos.
- Keep exactly one item in_progress at a time; update the list right after each step finishes.
- Mark at most ONE todo completed (or failed) per call. To close several, call this tool once per todo.
- Close the loop: when a task is done, mark it completed with a result (what was done + how it was verified) written into the result field; when it fails, record why. The list is a running ledger you settle as you go — do not create it and then stop updating it until the final answer.
- Skip it only for trivial single-step tasks, pure Q&A, or casual chat.

For dependency graphs (blockedBy), use todo_create_batch instead. When delegating to a sub-agent, pass the todo id as the agent tool's todoId parameter.`,
    inputSchema: todoWriteToolSchema,
    execute: async (input: TodoWriteToolInput) => {
      try {
        const existing = store.getTodosByConversation(conversationId);
        const existingById = new Map(existing.map((t) => [t.id, t]));
        const seenIds = new Set<string>();
        const result: Array<{ id: string; subject: string; status: TodoStatus }> = [];

        const completionError = validateSingleCompletion(input.todos, existingById);
        if (completionError) {
          return { success: false as const, error: completionError };
        }

        const warnings = collectPlanWarnings(input.todos);

        for (const item of input.todos) {
          const metadata = itemMetadata(item);
          if (item.id && existingById.has(item.id)) {
            // 更新已有任务
            const updated = store.updateTodo({
              id: item.id,
              subject: item.subject,
              status: item.status,
              activeForm: item.activeForm ?? null,
              ...(metadata ? { metadata } : {}),
            });
            seenIds.add(item.id);
            if (updated) {
              result.push({ id: updated.id, subject: updated.subject, status: updated.status });
              // 可观测：路径 A 完成（todo_write 跃迁，非全表重传的已完成项）
              if (updated.status === 'completed' && isCompletionTransition(item, existingById)) {
                logger.info('TodoWrite', `[path-a-complete] todoId=${updated.id}`);
              }
              notifyTodoCompleted(opts, updated.id, updated.status);
            }
          } else {
            // 新建任务（store 创建后默认 pending，需要时再置状态）
            const created = store.createTodo({ conversationId, subject: item.subject });
            if (item.status !== 'pending' || item.activeForm || metadata) {
              store.updateTodo({
                id: created.id,
                status: item.status,
                activeForm: item.activeForm ?? null,
                ...(metadata ? { metadata } : {}),
              });
            }
            seenIds.add(created.id);
            const final = store.getTodo(created.id) ?? created;
            result.push({ id: final.id, subject: final.subject, status: final.status });
            // 可观测：路径 A 完成（新建即 completed）
            if (final.status === 'completed' && isCompletionTransition(item, existingById)) {
              logger.info('TodoWrite', `[path-a-complete] todoId=${final.id}`);
            }
            notifyTodoCompleted(opts, final.id, final.status);
          }
        }

        // 鲁棒语义（2026-08-15）：不静默删除未列出的活跃项——模型常只传"当前项"的
        // 滚动窗口，删除会让未列出的待办丢失（面板 5→2→3 崩塌）。取消某项请显式传
        // status: 'cancelled'（走上面的 update 路径，软取消并保留记录）。

        return {
          success: true as const,
          todos: result,
          ...(warnings.length > 0 ? { message: `Warning: ${warnings.join(' ')}` } : {}),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
