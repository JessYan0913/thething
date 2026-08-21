import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore, Todo, TodoStatus } from '../types';
import { logger } from '../../../primitives/logger';
import { indexActiveTodos, resolveActiveByIndex, resolveByStableIndex, isActiveStatus } from '../snapshot-index';
import { renderIndexedActiveList } from './todo-snapshot';
import type { TodoRuntime, TransitionError } from '../todo-runtime';

/**
 * TodoWriteTool - 任务清单管理（主入口，方案 C：agent 自管）
 *
 * 方案 C 核心：agent 凭**语义**管理任务清单，机器不判重、不去重。
 * - 定位用**快照序号**（1-based，对应列表里每项 [#N]），不传 id、不按标题自动映射。
 * - **patch 语义**：本调用只**变更入参里引用到的项**；未提及的 todo 保持原状。
 *   —— 不再有"未列出即取消"（True-Replace 已废除）。要取消某项用 `index + status:'cancelled'`
 *      （或 todo_delete）。
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
  /** 本调用要变更的项（patch 语义：只动入参引用的项；未提及的保持原状） */
  todos: z.array(TodoWriteItemSchema).max(20)
    .describe('The changes to apply to the task list. Each item references an existing active task by its [#N] index (to update it), or omits index and provides a subject to CREATE a new task. Unlisted tasks are left untouched — this is a PATCH, not a full replacement. To cancel a task, reference it by index with status "cancelled" (or use todo_delete). Completed/failed/cancelled history is preserved automatically.'),
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

/** 确定性的规划质量检查（lint 式返回值反馈，不阻断执行）。 */
function collectPlanWarnings(
  todos: Array<{ index?: number; subject?: string; status: TodoStatus; result?: string; error?: string }>,
  resolve: (index: number) => Todo | undefined,
): string[] {
  const warnings: string[] = [];

  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;
  if (inProgressCount > 1) {
    warnings.push(`${inProgressCount} todos are in_progress. Keep exactly one in_progress at a time.`);
  }

  // T5：单完成约束硬失败 → lint。账本不判：一次标多个 completed/failed 仅提醒，不再阻断。
  // 只统计真实发生的 completed/failed 跃迁（整表重传已终态的项不计）。
  const completions = new Set<string>();
  for (const item of todos) {
    if (item.index !== undefined) {
      const target = resolve(item.index);
      if (item.status === 'completed' || item.status === 'failed') {
        if (target && target.status !== 'completed' && target.status !== 'failed') {
          completions.add(item.subject ?? `#${item.index}`);
        }
      }
    } else if (item.status === 'completed' || item.status === 'failed') {
      completions.add(item.subject ?? '(new)');
    }
  }
  if (completions.size > 1) {
    warnings.push(`marked ${completions.size} todos completed/failed in one call (${[...completions].join(', ')}). Prefer finishing one task per call so each result is recorded before moving on.`);
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

/** 从工具入参提取 metadata 增量（只包含显式提供的字段，避免覆盖已有值）。 */
function itemMetadata(item: TodoWriteToolInput['todos'][number]): Record<string, string> | undefined {
  const meta: Record<string, string> = {};
  if (item.verify !== undefined) meta.verify = item.verify;
  if (item.result !== undefined) meta.result = item.result;
  if (item.error !== undefined) meta.error = item.error;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** TransitionError → 面向模型的友好错误 + 重读快照 hint（与 index 越界行为一致）。 */
function transitionErrorHint(code: TransitionError, subject: string): string {
  const hints: Record<TransitionError, string> = {
    NOT_FOUND: `${subject} no longer exists.`,
  };
  return hints[code];
}

/**
 * 对已存在 todo 执行 status 迁移：经 runtime 强校验（模型决策、系统执行分层）。
 * 返回 { todo } 成功，或 { error } 失败。仅处理状态语义；其余字段由调用方另走 store.updateTodo。
 */
function applyStatusTransition(
  store: TodoStore,
  scheduler: TodoRuntime,
  todo: Todo,
  status: TodoStatus,
  opts: {
    result?: string;
    error?: string;
    retryable?: boolean;
    cancelReason?: string;
  } = {},
):
  | { todo: Todo }
  | { error: string }
{
  const subject = `#${todo.subject}`;
  const label = `"${todo.subject}"`;
  // no-op：同状态重传（方案 C 每轮重发整个活跃清单必然重发当前 in_progress/pending）→ 直接沿用，不触发 claim。
  if (todo.status === status) {
    return { todo };
  }
  try {
    switch (status) {
      case 'in_progress':
        return { todo: scheduler.claimTodo(todo.id, { agentId: 'main' }) };
      case 'completed':
        return { todo: scheduler.completeTodo(todo.id, opts.result ?? '') };
      case 'failed':
        return { todo: scheduler.failTodo(todo.id, opts.error ?? '', opts.retryable) };
      case 'cancelled':
        return { todo: scheduler.cancelTodo(todo.id, opts.cancelReason) };
      case 'pending':
        // failed→pending 重试：显式 retry
        if (todo.status === 'failed' || todo.status === 'cancelled') {
          return { todo: scheduler.retryTodo(todo.id) };
        }
        // 其他 pending 场景（同状态/no-op）走 store 宽松更新
        return { todo: store.updateTodo({ id: todo.id, status }) ?? todo };
      default:
        return { todo: store.updateTodo({ id: todo.id, status }) ?? todo };
    }
  } catch (e) {
    const code = (e as unknown as { code?: TransitionError })?.code;
    if (e instanceof Error && code) {
      return { error: `(${transitionErrorHint(code, label)}) ${e.message}` };
    }
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create a TodoWriteTool bound to a conversation
 *
 * @param store - The todo store
 * @param conversationId - The conversation ID to associate todos with
 * @param opts - scheduler 供状态翻转经 TodoRuntime 强校验（模型决策、系统执行分层）。
 * @returns The tool definition
 */
export function createTodoWriteToolForConversation(
  store: TodoStore,
  conversationId: string,
  opts: { scheduler: TodoRuntime },
) {
  return tool({
    description: `Create and update the task list for the current session. The PREFERRED tool for task planning — use it to decompose complex work.

When the user's request is complex — a problem that benefits from being split into a few sub-tasks you think through and execute one by one (multiple facets, trade-offs, uncertainty, exploration, iteration) — your FIRST action should be calling this tool to lay out the plan. Do not start working before the list exists.

How to reference tasks (方案 C — you manage the list by semantics, no ids):
- Every active task is shown with a bracket number like [#3]. Reference a task by that number in \`index\`.
- \`index\` + \`status\`/fields → update that task. Omit \`index\` and provide \`subject\` → create a new task.
- PATCH semantics: this call only changes the tasks you reference. Tasks you DON'T mention are left exactly as they are — no automatic cancellation. To cancel a task, reference it by index with status "cancelled" (or use todo_delete). So: update progress/state explicitly, and cancel explicitly — nothing vanishes silently.
- SEMANTIC DUPLICATES: if two active tasks are really the same work even with different titles (e.g. [#1] "调研 write" and [#3] "写 write"), merge them: \`merge\` with keepIndex and dropIndices. The dropped one is cancelled and folded in. This is how you keep the list clean by judgment — the system never dedupes for you.
- Keep exactly one item in_progress at a time — a lint-style recommendation, not enforced; update the list right after each work step so the canvas stays honest.
- Prefer finishing one task per call — marking several completed/failed in one call only warns, it does not block.
- Close the loop: when a task is done, mark it completed with a result (what was done + how verified); when it fails, record why. Do not create the list and stop updating it until the final answer.
- Skip it only for trivial single-step tasks, pure Q&A, or chat.

For dependency graphs (blockedBy), use todo_create_batch instead.`,
    inputSchema: todoWriteToolSchema,
    execute: async (input: TodoWriteToolInput) => {
      try {
        const existing = store.getTodosByConversation(conversationId);
        const resolve = (index: number) => resolveActiveByIndex(existing, index);

        const todos = input.todos ?? [];
        const warnings = collectPlanWarnings(todos, resolve);
        const touchedIds = new Set<string>();

        // Phase 1: todos[] — 按 index 更新，或新建
        const result: Array<{ index: number; subject: string; status: TodoStatus }> = [];
        for (const item of todos) {
          const metadata = itemMetadata(item);
          const target = item.index !== undefined ? resolve(item.index) : undefined;

          // index 不在活跃清单：全级解析（含终态）给出有针对性的提示，而非静默新建——
          // 逼 agent 重读最新清单，但先告知它这个编号指向什么（T5：含终态给予提示）。
          if (item.index !== undefined && !target) {
            const terminal = resolveByStableIndex(existing, item.index);
            if (terminal) {
              return {
                success: false as const,
                error: `index ${item.index} refers to "${terminal.subject}", which is already ${terminal.status} (收尾/终态) — the active list no longer includes it. If you meant to reopen that work, create a NEW task with the same subject; otherwise re-read the latest snapshot for current [#N] indices.`,
              };
            }
            return {
              success: false as const,
              error: `index ${item.index} does not match any task. The list changed — re-read the latest snapshot and retry with current indices.`,
            };
          }

          if (target) {
            touchedIds.add(target.id);
            // 状态迁移经 Scheduler 强校验（模型决策、系统执行分层）；subject/activeForm/metadata 另走 store。
            const transition = applyStatusTransition(store, opts.scheduler, target, item.status, {
              result: item.result,
              error: item.error,
              cancelReason: 'todo_write',
            });
            if ('error' in transition) {
              return {
                success: false as const,
                error: `${transition.error} (re-read the latest snapshot and retry)`,
              };
            }
            const afterStatus = transition.todo;
            const updated = store.updateTodo({
              id: target.id,
              subject: item.subject, // undefined → 沿用既有标题
              activeForm: item.activeForm ?? null,
              ...(metadata ? { metadata } : {}),
            }) ?? afterStatus;
            if (updated) {
              result.push({ index: item.index!, subject: updated.subject, status: updated.status });
              if (updated.status === 'completed' && isCompletionTransition(item.status, target, false)) {
                logger.info('TodoWrite', `[path-a-complete] todoId=${updated.id}`);
              }
            }
          } else {
            // 新建（无 index 且 subject 必填）
            const created = store.createTodo({ conversationId, subject: item.subject! });
            touchedIds.add(created.id);
            let final = store.getTodo(created.id) ?? created;
            // 新建即完成/失败：经 Scheduler 走 claim→complete/fail 内部链（terminal 只允许从 in_progress 转出）。
            const declared = item.status;
            if (declared !== 'pending' || item.activeForm || metadata) {
              const chainedStatus = declared === 'completed' || declared === 'failed'
                ? 'in_progress'
                : declared;
              const claimRes = applyStatusTransition(store, opts.scheduler, final, chainedStatus, {
                cancelReason: 'todo_write',
              });
              if ('error' in claimRes) {
                store.deleteTodo(created.id);
                return { success: false as const, error: `${claimRes.error} (new todo rolled back; re-read the latest snapshot and retry)` };
              }
              final = claimRes.todo;
              // 应用非状态字段（activeForm/metadata），随后按声明状态收尾
              store.updateTodo({
                id: created.id,
                activeForm: item.activeForm ?? null,
                ...(metadata ? { metadata } : {}),
              });
              if (declared === 'completed' || declared === 'failed') {
                const done = applyStatusTransition(store, opts.scheduler, store.getTodo(created.id) ?? final, declared, {
                  result: item.result,
                  error: item.error,
                });
                if ('error' in done) {
                  store.deleteTodo(created.id);
                  return { success: false as const, error: `${done.error} (new todo rolled back; re-read the latest snapshot and retry)` };
                }
                final = done.todo;
              }
              final = store.getTodo(created.id) ?? final;
            }
            // 新建项没有 index（不在调用前快照里）——按最终活跃顺序补编号
            result.push({ index: -1, subject: final.subject, status: final.status });
            if (final.status === 'completed' && isCompletionTransition(item.status, undefined, true)) {
              logger.info('TodoWrite', `[path-a-complete] todoId=${final.id}`);
            }
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
            const cancel = applyStatusTransition(store, opts.scheduler, drop, 'cancelled', { cancelReason: 'merged' });
            if ('error' in cancel) {
              return { success: false as const, error: `${cancel.error} (re-read the latest snapshot and retry)` };
            }
            // 合并结清：在生命周期上记录 mergedInto，替换旧 ad-hoc `_merged_into` metadata
            store.updateTodo({
              id: drop.id,
              metadata: {
                ...(drop.metadata ?? {}),
                lifecycle: { ...((drop.metadata?.lifecycle ?? {}) as object), mergedInto: keep.id },
              },
            });
            logger.info('TodoWrite', `[merge] drop todoId=${drop.id} (${drop.subject}) -> keep todoId=${keep.id}`);
          }

          store.updateTodo({
            id: keep.id,
            subject: m.subject ?? keep.subject,
          });
          logger.info('TodoWrite', `[merge] keep todoId=${keep.id}${m.subject ? ` -> "${m.subject}"` : ''}, dropped=[${dropIds.join(', ')}]`);
        }

        // Phase 3: （patch 语义）无整表取消——未提及的 todo 原样保留。
        // 取消走显式 `index + status:'cancelled'` 或 todo_delete。

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
