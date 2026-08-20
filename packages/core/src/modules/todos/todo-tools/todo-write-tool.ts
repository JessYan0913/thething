import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore, Todo, TodoStatus } from '../types';
import { logger } from '../../../primitives/logger';
import { indexActiveTodos, resolveActiveByIndex, isActiveStatus } from '../snapshot-index';
import { renderIndexedActiveList } from './todo-snapshot';

/**
 * TodoWriteTool - 任务清单管理（主入口，方案 C：agent 自管）
 *
 * 方案 C 核心：agent 凭**语义**管理任务清单，机器不判重、不去重。
 * - 定位用**快照序号**（1-based，对应清单里每项前面的 [#N]），不传 id、不按标题自动映射。
 * - **真替换**：清单之外未列出的活跃待办（pending/failed）会被软取消；in_progress 恒保留。
 *   —— 这让 agent 每轮传"它想保留的完整活跃清单"即可自然收敛，无需发明任何身份。
 * - **显式 merge**：agent 发现两个编号是同一件事（如 [#1]调研X、[#3]写X）→ merge 合一。
 * - 机器零自动去重：两个字面相同标题也会并存，由 agent 用序号引用或 merge 化解。
 */

const TodoWriteItemSchema = z.object({
  /** 引用当前清单里的活跃任务序号（1-based，对应渲染里的 [#N]）；省略=按 subject 新建 */
  index: z.number().int().positive().optional()
    .describe('Index (1-based) of an active task in the current list, as shown in brackets like [#3]. Use it to UPDATE an existing task. Omit to create a NEW task (subject required). Indices are re-read fresh each turn from the last snapshot this tool returned.'),
  /** 任务标题。按 index 更新时可省略（沿用该行标题）；新建时必填。 */
  subject: z.string().min(1).optional()
    .describe('Task title in imperative form. Optional when updating by index (existing title kept); REQUIRED when creating a new todo (no index).'),
  /** 任务状态 */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
    .describe('Task status'),
  /** 进行中时的现在进行时描述 */
  activeForm: z.string().optional()
    .describe('Present-tense label shown while in_progress (e.g. "Running tests")'),
  /** 完成标准（可执行的验证方式） */
  verify: z.string().optional()
    .describe('How to verify this task is done — an executable check where possible (e.g. "npx vitest run src/utils passes").'),
  /** 完成时的结论 */
  result: z.string().optional()
    .describe('When marking completed: one line on what was done and how it was verified. Later steps and sub-agents rely on this instead of conversation memory.'),
  /** 失败原因 */
  error: z.string().optional()
    .describe('When marking failed: why it failed, so the plan can be revised instead of silently stalling.'),
});

const TodoMergeSchema = z.object({
  /** 合并后保留的活跃任务序号 */
  keepIndex: z.number().int().positive().describe('Index of the task to KEEP after merging (the surviving task).'),
  /** 被合并掉（结清/cancelled）的活跃任务序号，其标题与 keepIndex 是同一件事 */
  dropIndices: z.array(z.number().int().positive()).min(1)
    .describe('Indices of tasks that are actually the SAME task as keepIndex (e.g. a duplicate title, or "调研 X" and "写 X" meaning the same work). These are cancelled and their content folded into keepIndex.'),
  /** 合并后保留任务（keepIndex）的新标题（可选） */
  subject: z.string().min(1).optional().describe('New title for the surviving (keepIndex) task after merging, if it should be renamed.'),
});

export const todoWriteToolSchema = z.object({
  /** 目标活跃任务清单（真替换：清单外未列出的活跃待办会被取消；in_progress 恒保留） */
  todos: z.array(TodoWriteItemSchema).max(20)
    .describe('The ACTIVE task list you want to keep. Existing active tasks not referenced here (by index) are CANCELLED, except any currently in_progress. So pass the FULL set of tasks you want to remain, plus the ones you are advancing/completing. Completed/failed/cancelled history is preserved automatically.'),
  /** 合并重复项：把"其实是同一件事"的两个活跃任务合一 */
  merge: z.array(TodoMergeSchema).max(5).optional()
    .describe('Explicitly merge tasks that are really the same work (semantic duplicates). Use when two active tasks describe the same thing — e.g. [#1] "调研 write" and [#3] "写 write" are one task.'),
}).superRefine((val, ctx) => {
  val.todos.forEach((item, i) => {
    if (!item.index && !item.subject) {
      ctx.addIssue({
        code: 'custom',
        path: ['todos', i, 'subject'],
        message: 'subject is required when creating a new todo (an index was not provided)',
      });
    }
  });
});

export type TodoWriteToolInput = z.infer<typeof todoWriteToolSchema>;

export type TodoWriteToolOutput = {
  success: true;
  todos: Array<{ index: number; subject: string; status: TodoStatus }>;
  snapshot: string;
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

/** 确定性的规划质量检查（lint 式返回值反馈，不阻断执行）。 */
function collectPlanWarnings(
  todos: Array<{ index?: number; subject?: string; status: TodoStatus; result?: string; error?: string }>,
): string[] {
  const warnings: string[] = [];

  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;
  if (inProgressCount > 1) {
    warnings.push(`${inProgressCount} todos are in_progress. Keep exactly one in_progress at a time.`);
  }

  const seenIndex = new Set<number>();
  for (const t of todos) {
    if (t.index !== undefined) {
      if (seenIndex.has(t.index)) {
        warnings.push(`index ${t.index} is referenced more than once in this call — only the last takes effect.`);
      }
      seenIndex.add(t.index);
    }
    if (t.status === 'completed' && !t.result) {
      warnings.push(`"${t.subject ?? `#${t.index}`}" marked completed without a result. Record what was done and how it was verified.`);
    }
    if (t.status === 'failed' && !t.error) {
      warnings.push(`"${t.subject ?? `#${t.index}`}" marked failed without an error. Record why, so the plan can be revised.`);
    }
  }

  return warnings;
}

/** 是否为本调用中真实发生的 completed/failed 跃迁（排除整表重传时已完成的项）。 */
function isCompletionTransition(
  status: TodoStatus,
  target: Todo | undefined,
  isNew: boolean,
): boolean {
  if (status !== 'completed' && status !== 'failed') return false;
  if (isNew || !target) return true; // 新建即完成/失败
  return target.status !== 'completed' && target.status !== 'failed'; // 状态跃迁到完成/失败
}

/** 单完成约束：一次调用只能将一个活跃 todo 标记为 completed/failed。 */
function validateSingleCompletion(
  items: TodoWriteToolInput['todos'],
  resolve: (index: number) => Todo | undefined,
): string | null {
  const transitions = new Set<string>();
  for (const item of items) {
    if (!item.index) continue; // 新建即完成按 subject 计
    const target = resolve(item.index);
    if (isCompletionTransition(item.status, target, false)) {
      transitions.add(item.subject ?? item.index.toString());
    }
  }
  const bySubject = items.filter((i) => !i.index && isCompletionTransition(i.status, undefined, true));
  const transitionsCount = transitions.size + bySubject.length;
  if (transitionsCount > 1) {
    return `一次只能将一个 todo 标记为 completed/failed，本次标记了 ${transitionsCount} 个。请分多次调用 todo_write。`;
  }
  return null;
}

/** 从工具入参提取 metadata 增量（只包含显式提供的字段，避免覆盖已有值）。 */
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
 * @param opts - 可选回调；onTodoCompleted 在子任务标记 completed 时触发（子任务独立上下文范式）
 * @returns The tool definition
 */
export function createTodoWriteToolForConversation(
  store: TodoStore,
  conversationId: string,
  opts?: { onTodoCompleted?: (todoId: string) => void },
) {
  return tool({
    description: `Create and update the task list for the current session. The PREFERRED tool for task planning — use it to decompose complex work.

When the user's request is complex — a problem that benefits from being split into a few sub-tasks you think through and execute one by one (multiple facets, trade-offs, uncertainty, exploration, iteration) — your FIRST action should be calling this tool to lay out the plan. Do not start working before the list exists.

How to reference tasks (方案 C — you manage the list by semantics, no ids):
- Every active task is shown with a bracket number like [#3]. Reference a task by that number in \`index\`.
- \`index\` + \`status\`/fields → update that task. Omit \`index\` and provide \`subject\` → create a new task.
- TRUE-REPLACE: this list is the full active set you want. Active tasks (pending/failed) you do NOT reference by index are CANCELLED; a task currently in_progress is never auto-cancelled. So re-issue, by index, every active task you want to keep, plus update the one you're working on.
- SEMANTIC DUPLICATES: if two active tasks are really the same work even with different titles (e.g. [#1] "调研 write" and [#3] "写 write"), merge them: \`merge\` with keepIndex and dropIndices. The dropped one is cancelled and folded in. This is how you keep the list clean by judgment — the system never dedupes for you.
- Keep exactly one item in_progress at a time; update the list right after each step finishes.
- Mark at most ONE todo completed (or failed) per call. To close several, call this tool once per todo.
- Close the loop: when a task is done, mark it completed with a result (what was done + how verified); when it fails, record why. Do not create the list and stop updating it until the final answer.
- Skip it only for trivial single-step tasks, pure Q&A, or casual chat.

For dependency graphs (blockedBy), use todo_create_batch instead.`,
    inputSchema: todoWriteToolSchema,
    execute: async (input: TodoWriteToolInput) => {
      try {
        const existing = store.getTodosByConversation(conversationId);
        const resolve = (index: number) => resolveActiveByIndex(existing, index);

        const todos = input.todos ?? [];
        const completionError = validateSingleCompletion(todos, resolve);
        if (completionError) {
          return { success: false as const, error: completionError };
        }

        const warnings = collectPlanWarnings(todos);
        const touchedIds = new Set<string>();

        // Phase 1: todos[] — 按 index 更新，或新建
        const result: Array<{ index: number; subject: string; status: TodoStatus }> = [];
        for (const item of todos) {
          const metadata = itemMetadata(item);
          const target = item.index !== undefined ? resolve(item.index) : undefined;

          // 越界/不存在 index：报错而非静默新建——逼 agent 重读最新清单
          if (item.index !== undefined && !target) {
            return {
              success: false as const,
              error: `index ${item.index} does not match any active task. The list changed — re-read the latest snapshot and retry with current indices.`,
            };
          }

          if (target) {
            touchedIds.add(target.id);
            const updated = store.updateTodo({
              id: target.id,
              subject: item.subject, // undefined → 沿用既有标题
              status: item.status,
              activeForm: item.activeForm ?? null,
              ...(metadata ? { metadata } : {}),
            });
            if (updated) {
              result.push({ index: item.index!, subject: updated.subject, status: updated.status });
              if (updated.status === 'completed' && isCompletionTransition(item.status, target, false)) {
                logger.info('TodoWrite', `[path-a-complete] todoId=${updated.id}`);
              }
              notifyTodoCompleted(opts, updated.id, updated.status);
            }
          } else {
            // 新建（无 index 且 subject 必填）
            const created = store.createTodo({ conversationId, subject: item.subject! });
            touchedIds.add(created.id);
            if (item.status !== 'pending' || item.activeForm || metadata) {
              store.updateTodo({
                id: created.id,
                status: item.status,
                activeForm: item.activeForm ?? null,
                ...(metadata ? { metadata } : {}),
              });
            }
            const final = store.getTodo(created.id) ?? created;
            // 新建项没有 index（不在调用前快照里）——按最终活跃顺序补编号
            result.push({ index: -1, subject: final.subject, status: final.status });
            if (final.status === 'completed' && isCompletionTransition(item.status, undefined, true)) {
              logger.info('TodoWrite', `[path-a-complete] todoId=${final.id}`);
            }
            notifyTodoCompleted(opts, final.id, final.status);
          }
        }

        // Phase 2: merge[] — 把"其实是同一件事"的活跃任务合一
        for (const m of input.merge ?? []) {
          const keep = resolve(m.keepIndex);
          if (!keep) {
            return {
              success: false as const,
              error: `merge.keepIndex ${m.keepIndex} does not match any active task. Re-read the latest snapshot.`,
            };
          }
          touchedIds.add(keep.id);

          const dropIds: string[] = [];
          for (const di of m.dropIndices) {
            const drop = resolve(di);
            if (!drop) {
              return {
                success: false as const,
                error: `merge.dropIndices ${di} does not match any active task. Re-read the latest snapshot.`,
              };
            }
            dropIds.push(drop.id);
            touchedIds.add(drop.id);
            store.updateTodo({
              id: drop.id,
              status: 'cancelled',
              metadata: { ...(drop.metadata ?? {}), _merged_into: keep.id },
            });
            logger.info('TodoWrite', `[merge] drop todoId=${drop.id} (${drop.subject}) -> keep todoId=${keep.id}`);
            // 若被合并的项恰是 in_progress → 结束它，避免面板残留
            notifyTodoCompleted(opts, drop.id, 'cancelled');
          }

          store.updateTodo({
            id: keep.id,
            subject: m.subject ?? keep.subject,
          });
          logger.info('TodoWrite', `[merge] keep todoId=${keep.id}${m.subject ? ` -> "${m.subject}"` : ''}, dropped=[${dropIds.join(', ')}]`);
        }

        // Phase 3: 真替换——未列出的活跃待办（pending/failed）软取消；in_progress 恒保留
        for (const t of existing) {
          if ((t.status === 'pending' || t.status === 'failed') && !touchedIds.has(t.id)) {
            store.updateTodo({ id: t.id, status: 'cancelled' });
            logger.info('TodoWrite', `[title-reconcile-cancelled] todoId=${t.id} subject="${t.subject}"`);
          }
        }

        // 输出最新活跃编号快照，供 agent 下一轮继续引用
        const after = store.getTodosByConversation(conversationId);
        const activeAfter = indexActiveTodos(after);
        const snapshot = renderIndexedActiveList(after, store);

        return {
          success: true as const,
          todos: activeAfter.map(({ index, todo }) => ({ index, subject: todo.subject, status: todo.status })),
          snapshot: snapshot ?? '（当前无活跃任务）',
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
