import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore, Todo, TodoStatus } from '../types';
import { logger } from '../../../primitives/logger';
import { indexActiveTodos, resolveActiveByIndex, resolveByStableIndex } from '../snapshot-index';
import { normalizeSubject } from '../subject-match';
import { buildCompactTaskSnapshot } from './todo-snapshot';
import type { TodoRuntime, TransitionError } from '../todo-runtime';

/**
 * TodoTool — 单一任务清单工具（方案 C + pi 式 action/id，docs/todos-lite.md §4/§5.5）。
 *
 * 工具面收敛为一个 `todo` 工具，五个 action 覆盖全部模型面操作：
 * - list   ：查看清单。默认紧凑快照（活跃 + 最近 done）；`scope:'all'` 全量含终态。
 * - add    ：批量新建（items[]，顺序即创建序），可带依赖提示 dependsOnSteps
 *            （1-based 数组位，映射为 blockedBy 提示）。返回 lint 警告，不阻断。
 * - update ：按 `#N` 引用一条任务，改状态/标题/进度/verify/result/error。
 *            status 即状态流转（claim/complete/fail/retry 都是 status）。
 * - delete ：按 `#N` 软取消（置 cancelled，保留历史编号与依赖提示）。
 * - clear  ：取消本会话所有活跃任务（清单清空；终态历史保留）。
 *
 * 关键语义：
 * - 模型面 id = `#N`（创建时物化的稳定编号，永不复用/重排，D2）；内部 id 模型永不接触。
 * - patch 语义：任何调用只影响明确引用的任务；未提及的保持原状。
 * - 零闸门：完整状态机迁移随便写（pending→completed 直通）；lint 只提示不阻断（T2/T5）。
 * - 权威全量 / 展示紧凑：默认返回紧凑快照；全量走 list({scope:'all'})。
 */

// ============================================================
// Schema
// ============================================================

const AddItemSchema = z.object({
  /** 任务标题（命令式，e.g. "Implement /export endpoint"） */
  subject: z.string().min(1).describe('Task title in imperative form.'),
  /** 初始状态。缺省 pending；in_progress 会认领为进行中。 */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional()
    .describe('Initial status (default: pending). "in_progress" claims it; "completed"/"failed" creates then finishes it immediately.'),
  /** 进行中时的现在进行时描述 */
  activeForm: z.string().optional()
    .describe('Present-tense label shown while in_progress (e.g. "Running tests").'),
  /** 完成标准（可执行的验证方式） */
  verify: z.string().optional()
    .describe('How to verify this task is done — an executable check where possible.'),
  /** 完成时的结论 */
  result: z.string().optional()
    .describe('When creating already-completed tasks: one line on what was done and how it was verified.'),
  /** 失败原因 */
  error: z.string().optional()
    .describe('When creating already-failed tasks: why it failed.'),
  /** 依赖提示：本批次内 1-based 位置（只能引用更早的项），映射为 blockedBy 依赖提示 */
  dependsOnSteps: z.array(z.number().int().min(1)).optional()
    .describe('1-based indices of steps (within this items array) this task depends on. Only earlier positions allowed. Treated as a dependency hint, not a hard gate.'),
});

const UpdateSchema = z.object({
  /** 目标任务编号 #N（当前清单的稳定编号） */
  id: z.string().regex(/^#?\d+$/, 'id must be a task number like "#3"')
    .describe('Task number from the list, e.g. "#3".'),
  /** 新状态：pending/in_progress/completed/failed/cancelled。含 claim/complete/fail/retry。 */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).optional()
    .describe('New status. Any transition is allowed (including pending→completed directly). "in_progress" claims it, "completed" finishes it (write a result), "failed" records why, "cancelled" gives up, "pending" reopens a failed/cancelled task (retry).'),
  /** 新标题 */
  subject: z.string().min(1).optional().describe('New task title (optional; existing title kept).'),
  /** 进行中描述；null 清除 */
  activeForm: z.string().nullable().optional().describe('Present-tense label, or null to clear it.'),
  /** 完成标准 */
  verify: z.string().optional().describe('How to verify this task is done.'),
  /** 完成结论 */
  result: z.string().optional().describe('When marking completed: one line on what was done + how verified.'),
  /** 失败原因 */
  error: z.string().optional().describe('When marking failed: why it failed.'),
});

export const todoToolSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list'),
    scope: z.enum(['all', 'active']).optional().describe('"all": full list including finished tasks. Omit for the compact active view.'),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).optional().describe('Filter by status.'),
    id: z.string().optional().describe('Get full details of a single task by its #N number.'),
  }),
  z.object({
    action: z.literal('add'),
    items: z.array(AddItemSchema).min(1).max(20),
  }),
  z.object({
    action: z.literal('update'),
    ...UpdateSchema.shape,
  }),
  z.object({
    action: z.literal('delete'),
    id: z.string().describe('Task number from the list, e.g. "#3".'),
  }),
  z.object({ action: z.literal('clear') }),
]);

export type TodoToolInput = z.infer<typeof todoToolSchema>;

// ============================================================
// 返回类型
// ============================================================

export interface TodoToolItem {
  /** 稳定编号 #N（模型面 id） */
  id: number;
  subject: string;
  status: TodoStatus;
  activeForm: string | null;
  claimedBy: string | null;
  verify?: string;
  result?: string;
  error?: string;
}

export type TodoToolOutput = {
  success: true;
  action: string;
  changed: number;
  todos: TodoToolItem[];
  snapshot: string;
  warnings?: string[];
} | {
  success: false;
  action: string;
  error: string;
};

function toModelTodo(t: Todo): TodoToolItem {
  const out: TodoToolItem = {
    id: t.number,
    subject: t.subject,
    status: t.status,
    activeForm: t.activeForm,
    claimedBy: t.claimedBy,
  };
  if (t.metadata?.verify) out.verify = String(t.metadata.verify);
  if (t.metadata?.result) out.result = String(t.metadata.result);
  if (t.metadata?.error) out.error = String(t.metadata.error);
  return out;
}

function isActiveStatus(s: TodoStatus): boolean {
  return s === 'pending' || s === 'in_progress' || s === 'failed';
}

/** TransitionError → 面向模型的友好错误 */
function transitionErrorHint(code: TransitionError, label: string): string {
  const hints: Record<TransitionError, string> = {
    NOT_FOUND: `${label} no longer exists.`,
  };
  return hints[code];
}

/**
 * 对已存在 todo 执行状态迁移（经 runtime：模型决策、系统执行）。同状态 no-op 直接沿用。
 * 返回 { todo } 成功，或 { error } 失败。
 */
function applyToTodo(store: TodoStore, scheduler: TodoRuntime, todo: Todo, status: TodoStatus, opts: {
  result?: string;
  error?: string;
  cancelReason?: string;
} = {}): { todo: Todo } | { error: string } {
  if (todo.status === status) return { todo };
  try {
    switch (status) {
      case 'in_progress':
        return { todo: scheduler.claimTodo(todo.id, { agentId: 'main' }) };
      case 'completed':
        return { todo: scheduler.completeTodo(todo.id, opts.result ?? '') };
      case 'failed':
        return { todo: scheduler.failTodo(todo.id, opts.error ?? '', true) };
      case 'cancelled':
        return { todo: scheduler.cancelTodo(todo.id, opts.cancelReason) };
      case 'pending':
        // failed/cancelled → pending 重开（retry）；其他场景走 store 宽松更新
        if (todo.status === 'failed' || todo.status === 'cancelled') {
          return { todo: scheduler.retryTodo(todo.id) };
        }
        return { todo: store.updateTodo({ id: todo.id, status }) ?? todo };
      default:
        return { todo: store.updateTodo({ id: todo.id, status }) ?? todo };
    }
  } catch (e) {
    const code = (e as unknown as { code?: TransitionError })?.code;
    const msg = e instanceof Error ? e.message : String(e);
    return code ? { error: `${transitionErrorHint(code, `"${todo.subject}"`)} ${msg}` } : { error: msg };
  }
}

/** 校验 dependsOnSteps 引用合法（1-based，仅前向） */
function validateDependsOnSteps(items: Array<{ subject: string; dependsOnSteps?: number[] }>): string | null {
  for (let i = 0; i < items.length; i++) {
    const deps = items[i].dependsOnSteps ?? [];
    const pos = i + 1;
    for (const dep of deps) {
      if (dep < 1 || dep > items.length) {
        return `item ${pos} ("${items[i].subject}"): dependsOnSteps[${dep}] is out of range (valid 1-${items.length})`;
      }
      if (dep >= pos) {
        return `item ${pos} ("${items[i].subject}"): dependsOnSteps[${dep}] is a forward reference — a step can only depend on earlier steps (1-${pos - 1})`;
      }
    }
  }
  return null;
}

/** 确定性 lint（只提示不阻断；沿用 T2 单进行中 / T5 单完成收口口径） */
function collectWarnings(
  existing: Todo[],
  newItems: Array<{ subject: string; status?: TodoStatus; result?: string; error?: string }>,
): string[] {
  const warnings: string[] = [];

  // T2：多 in_progress → lint（不再硬 gate）
  const inProgressAsking = newItems.filter((i) => i.status === 'in_progress').length;
  if (inProgressAsking + existing.filter((t) => t.status === 'in_progress').length > 1) {
    warnings.push('more than one task is in_progress. Keep exactly one in_progress at a time.');
  }

  // dup 标题 lint：新增命中当前活跃清单已有标题，或本调用内重复
  const activeIndexBySubject = new Map<string, number>();
  for (const { index, todo } of indexActiveTodos(existing)) {
    const key = normalizeSubject(todo.subject);
    if (!activeIndexBySubject.has(key)) activeIndexBySubject.set(key, index);
  }
  const created = new Set<string>();
  for (const item of newItems) {
    const key = normalizeSubject(item.subject);
    if (!key) continue;
    const hit = activeIndexBySubject.get(key);
    if (hit !== undefined) {
      warnings.push(`creating "${item.subject}" as a new todo, but the active list already has the same title at [#${hit}]. If it is the same work, update [#${hit}] instead of creating a duplicate.`);
    } else if (created.has(key)) {
      warnings.push(`"${item.subject}" is created more than once in this call — task titles should be unique.`);
    }
    created.add(key);
  }

  // T5：一次标多个完成/失败 → lint
  const completions = newItems.filter((i) => i.status === 'completed' || i.status === 'failed');
  if (completions.length > 1) {
    warnings.push(`marked ${completions.length} todos completed/failed in one call. Prefer finishing one task per update so each result is recorded.`);
  }
  for (const item of newItems) {
    if (item.status === 'completed' && !item.result) {
      warnings.push(`"${item.subject}" marked completed without a result. Record what was done and how it was verified.`);
    }
    if (item.status === 'failed' && !item.error) {
      warnings.push(`"${item.subject}" marked failed without an error. Record why, so the plan can be revised.`);
    }
  }

  return warnings;
}

const TODO_DESCRIPTION = `Manage the session task list — the PREFERRED tool for planning (decompose multi-step work, track progress, keep the list honest). Use it whenever the user's request benefits from steps you execute one by one.

Actions (patch semantics — unmentioned tasks are never touched):
- add: create one or several tasks up front (items[]). Lay the full skeleton in ONE add before starting, then update tasks as you go — never re-create a task that already exists.
- update: change a task by its #N — set status (in_progress/completed/failed/cancelled/pending-retry), subject, activeForm, verify, result, error.
- delete: abandon a task by #N (marks cancelled; number never reused).
- list: re-read the list (full history with scope:"all").
- clear: cancel all currently active tasks.

Referencing tasks: every active task shows a stable number like [#3] — reference it by number (never an internal id). Numbers are assigned at creation and never reused or reordered, so [#3] always means the same task. Keep exactly one task in_progress at a time; update the list right after each work step. On completion write a result (what + how verified); on failure record the error. A warnings field is advisory only, never blocking. Skip planning only for trivial single-step work, pure Q&A, or chat.`;

export type TodoTool = ReturnType<typeof createTodoToolForConversation>;

/**
 * 创建会话绑定的单 `todo` 工具。
 */
export function createTodoToolForConversation(
  store: TodoStore,
  conversationId: string,
  opts: { scheduler: TodoRuntime },
) {
  return tool({
    description: TODO_DESCRIPTION,
    inputSchema: todoToolSchema,
    execute: async (input: TodoToolInput): Promise<TodoToolOutput> => {
      try {
        const existing = store.getTodosByConversation(conversationId);

        // ---------- list ----------
        if (input.action === 'list') {
          const all = store.getTodosByConversation(conversationId);
          if (input.id) {
            const n = Number(input.id.replace('#', ''));
            const byNumber = resolveByStableIndex(all, n);
            if (!byNumber) {
              return { success: false as const, action: input.action, error: `#${n} does not match any task. Re-read the latest list.` };
            }
            const t = byNumber;
            const detail = [
              `[#${t.number}] ${t.subject} — ${t.status}`,
              t.activeForm ? `activeForm: ${t.activeForm}` : '',
              t.metadata?.verify ? `verify: ${t.metadata.verify}` : '',
              t.status === 'in_progress' && t.claimedBy ? `claimedBy: ${t.claimedBy}` : '',
              t.metadata?.result ? `result: ${t.metadata.result}` : '',
              t.metadata?.error ? `error: ${t.metadata.error}` : '',
            ].filter(Boolean).join('\n');
            return {
              success: true as const,
              action: input.action,
              changed: 0,
              todos: [toModelTodo(byNumber)],
              snapshot: detail,
            };
          }

          const scopeAll = input.scope === 'all';
          const todos = all.filter((t) => {
            if (input.status && t.status !== input.status) return false;
            return scopeAll || isActiveStatus(t.status);
          });
          const snapshot = buildCompactTaskSnapshot(all, store) ?? '（当前没有任务。）';
          return {
            success: true as const,
            action: input.action,
            changed: 0,
            todos: todos.map(toModelTodo),
            snapshot,
          };
        }

        // ---------- add ----------
        if (input.action === 'add') {
          const validation = validateDependsOnSteps(input.items);
          if (validation) return { success: false as const, action: input.action, error: validation };

          const warnings = collectWarnings(existing, input.items);
          const createdIds: string[] = [];
          let changed = 0;

          for (let i = 0; i < input.items.length; i++) {
            const item = input.items[i];
            const blockedBy: string[] = [];
            for (const step of item.dependsOnSteps ?? []) {
              const dep = createdIds[step - 1];
              if (dep) blockedBy.push(dep);
            }

            const meta: Record<string, string> = {};
            if (item.verify !== undefined) meta.verify = item.verify;
            if (item.result !== undefined) meta.result = item.result;
            if (item.error !== undefined) meta.error = item.error;

            const created = store.createTodo({
              conversationId,
              subject: item.subject,
              blockedBy,
              metadata: meta,
            });
            createdIds.push(created.id);
            changed++;

            if (item.status && item.status !== 'pending') {
              // 声明非 pending（in_progress/terminal）→ 链式迁移
              const chained = applyToTodo(store, opts.scheduler, store.getTodo(created.id) ?? created, item.status === 'completed' || item.status === 'failed' ? 'in_progress' : item.status);
              if ('error' in chained) {
                store.deleteTodo(created.id);
                return { success: false as const, action: input.action, error: `${chained.error} (new todo rolled back)` };
              }
              if (item.activeForm !== undefined) {
                store.updateTodo({ id: created.id, activeForm: item.activeForm ?? null });
              }
              if (item.status === 'completed' || item.status === 'failed') {
                const done = applyToTodo(store, opts.scheduler, store.getTodo(created.id) ?? chained.todo, item.status, {
                  result: item.result,
                  error: item.error,
                });
                if ('error' in done) {
                  store.deleteTodo(created.id);
                  return { success: false as const, action: input.action, error: `${done.error} (new todo rolled back)` };
                }
              }
            } else if (item.activeForm !== undefined) {
              store.updateTodo({ id: created.id, activeForm: item.activeForm ?? null });
            }
            logger.info('TodoTool', `[add] number=${created.number} "${created.subject}"`);
          }

          return finish(store, conversationId, input.action, changed, warnings);
        }

        // ---------- update ----------
        if (input.action === 'update') {
          const n = Number(input.id.replace('#', ''));
          const target = resolveActiveByIndex(existing, n);
          if (!target) {
            const terminal = resolveByStableIndex(existing, n);
            if (terminal) {
              return {
                success: false as const,
                action: input.action,
                error: `#${n} refers to "${terminal.subject}" which is already ${terminal.status} (already finished) — the active list no longer includes it. If you meant to reopen that work, create a NEW task with the same subject; otherwise re-read the latest list for current #N.`,
              };
            }
            return {
              success: false as const,
              action: input.action,
              error: `#${n} does not match any task. The list changed — re-read the latest list and retry.`,
            };
          }

          const warnings: string[] = [];
          if (input.status && input.status !== target.status) {
            if (input.status === 'in_progress') {
              const othersInProgress = existing.filter((t) => t.status === 'in_progress' && t.id !== target.id).length;
              if (othersInProgress > 0) {
                warnings.push('the active list already has another task in_progress. Keep exactly one in_progress at a time.');
              }
            }
            const transition = applyToTodo(store, opts.scheduler, target, input.status, {
              result: input.result,
              error: input.error,
              cancelReason: 'todo',
            });
            if ('error' in transition) {
              return { success: false as const, action: input.action, error: `${transition.error} (re-read the latest list and retry)` };
            }
            if (input.status === 'completed' && !input.result) {
              warnings.push(`#${n} marked completed without a result. Record what was done and how it was verified.`);
            }
            if (input.status === 'failed' && !input.error) {
              warnings.push(`#${n} marked failed without an error. Record why, so the plan can be revised.`);
            }
          }

          const meta: Record<string, string> = {};
          if (input.verify !== undefined) meta.verify = input.verify;
          if (input.result !== undefined) meta.result = input.result;
          if (input.error !== undefined) meta.error = input.error;

          const patch: Record<string, unknown> = { id: target.id };
          if (input.subject !== undefined) patch.subject = input.subject;
          if (input.activeForm !== undefined) patch.activeForm = input.activeForm;
          if (Object.keys(meta).length > 0) patch.metadata = meta;
          // 仅 id（纯 no-op）不触发额外事件
          if (Object.keys(patch).length > 1) {
            store.updateTodo(patch as unknown as Parameters<TodoStore['updateTodo']>[0]);
          }
          logger.info('TodoTool', `[update] #${n} -> ${(store.getTodo(target.id) ?? target).status}`);
          return finish(store, conversationId, input.action, 1, warnings);
        }

        // ---------- delete ----------
        if (input.action === 'delete') {
          const n = Number(input.id.replace('#', ''));
          const target = resolveActiveByIndex(existing, n);
          if (!target) {
            const terminal = resolveByStableIndex(existing, n);
            return {
              success: false as const,
              action: input.action,
              error: terminal
                ? `#${n} ("${terminal.subject}") is already ${terminal.status} — nothing to delete.`
                : `#${n} does not match any task. Re-read the latest list and retry.`,
            };
          }
          applyToTodo(store, opts.scheduler, target, 'cancelled', { cancelReason: 'todo:delete' });
          logger.info('TodoTool', `[delete] #${n} "${target.subject}"`);
          return finish(store, conversationId, input.action, 1);
        }

        // ---------- clear ----------
        if (input.action === 'clear') {
          let changed = 0;
          for (const t of indexActiveTodos(existing)) {
            applyToTodo(store, opts.scheduler, t.todo, 'cancelled', { cancelReason: 'todo:clear' });
            changed++;
          }
          return finish(store, conversationId, input.action, changed);
        }

        return { success: false as const, action: 'list', error: `Unknown action: ${(input as { action: string }).action}` };
      } catch (error) {
        return {
          success: false as const,
          action: (input as { action: string }).action,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // 以纯文本形式发送给模型,避免 todos 数组经 JSON 序列化时的转义开销。
    // 模型面只需紧凑快照文本(snapshot 已含物化 #N)；(画布/复刻消费结构化字段)。
    // 见 docs/compaction-redesign.md
    toModelOutput: ({ output }) => {
      if (!output || typeof output !== 'object') {
        return { type: 'text' as const, value: '' };
      }
      const r = output as Record<string, unknown>;

      if (r.success === false) {
        const message = typeof r.error === 'string' ? r.error : 'todo operation failed';
        return { type: 'text' as const, value: `❌ ${message}` };
      }

      const snapshot = typeof r.snapshot === 'string' ? r.snapshot : '';
      return { type: 'text' as const, value: snapshot || '(todos updated)' };
    },
  });
}

/** 统一收尾：读取最新活性快照并渲染紧凑文本（编号 = 物化 #N） */
function finish(
  store: TodoStore,
  conversationId: string,
  action: string,
  changed: number,
  warnings?: string[],
): TodoToolOutput {
  const all = store.getTodosByConversation(conversationId);
  const active = indexActiveTodos(all);
  const snapshot = buildCompactTaskSnapshot(all, store) ?? '暂无任务。';
  return {
    success: true as const,
    action,
    changed,
    todos: active.map(({ todo }) => toModelTodo(todo)),
    snapshot,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
  };
}