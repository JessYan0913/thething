/**
 * Todo Snapshot - Compact task list rendering for ContextInjector
 *
 * Renders a compact text snapshot of the current todo list.
 * Used by ContextInjector to inject into prepareStep and by
 * the system prompt todo-overview section.
 *
 * Design:
 * - No planning guidance (that lives in the system prompt)
 * - Compact format: one line per task, no timestamps/metadata
 * - Shows in_progress first, then pending (unblocked → blocked), then recent completed
 */

import type { TodoStore, Todo } from '../types';
import { indexActiveTodos } from '../snapshot-index';

/**
 * 渲染单个活跃任务的编号行 `[→] [#3] 标题 — 进度 (verify: ...) (依赖: ...)`。
 * 不含 id——agent 凭编号引用（方案 C）。
 */
export function renderIndexedActiveLine(index: number, todo: Todo, store: TodoStore): string {
  const parts: string[] = [];

  if (todo.metadata?.priority === 'high') parts.push('⚡');

  parts.push(todo.subject);

  // 未完结任务的完成标准（压缩/续做时知道"怎样算做完"）
  if ((todo.status === 'pending' || todo.status === 'in_progress') && todo.metadata?.verify) {
    parts.push(`(verify: ${todo.metadata.verify})`);
  }

  if (todo.activeForm) parts.push(`— ${todo.activeForm}`);
  if (todo.claimedBy) parts.push(`(认领: ${todo.claimedBy})`);

  if (todo.status === 'failed') parts.push(`❌${todo.metadata?.error ?? ''}`);

  if (todo.blockedBy.length > 0 && todo.status === 'pending') {
    const deps = todo.blockedBy.map(id => {
      const dep = store.getTodo(id);
      if (!dep) return `${id}(已删除)`;
      return dep.status === 'completed' ? `${dep.subject} ✅` : `${dep.subject} ⏳`;
    });
    parts.push(`(依赖: ${deps.join(', ')})`);
  }

  const sym = todo.status === 'in_progress' ? '[→]' : todo.status === 'failed' ? '[!]' : '[ ]';
  return `${sym} [#${index}] ${parts.join(' ')}`;
}

/**
 * 渲染当前所有活跃任务（pending/in_progress/failed）的编号清单。
 * 所有模型面界面（todo_write 输出、快照、台账/overview）共用，保证编号一致。
 */
export function renderIndexedActiveList(todos: Todo[], store: TodoStore): string | null {
  const active = indexActiveTodos(todos);
  if (active.length === 0) return null;
  return active.map(({ index, todo }) => renderIndexedActiveLine(index, todo, store)).join('\n');
}

/**
 * Build a compact text snapshot of the todo list
 *
 * @param todos - List of todos to render
 * @param store - TodoStore for dependency lookups
 * @returns Formatted snapshot string, or null if empty
 */
export function buildCompactTaskSnapshot(todos: Todo[], store: TodoStore): string | null {
  if (todos.length === 0) return null;

  const lines: string[] = [];
  const inProgress = todos.filter(t => t.status === 'in_progress');
  const pending = todos.filter(t => t.status === 'pending');
  const failed = todos.filter(t => t.status === 'failed');
  const completed = todos.filter(t => t.status === 'completed');

  // Stats line
  const stats = [
    inProgress.length > 0 ? `进行中: ${inProgress.length}` : '',
    pending.length > 0 ? `待办: ${pending.length}` : '',
    failed.length > 0 ? `失败: ${failed.length}` : '',
    completed.length > 0 ? `已完成: ${completed.length}` : '',
  ].filter(Boolean).join(' | ');

  if (stats) {
    lines.push(`[任务清单] ${stats}`);
  }

  // 活跃任务（进行中 → 待办 → 失败）统一按编号渲染（方案 C：agent 凭编号引用，无 id）
  const active = indexActiveTodos(todos);
  for (const { index, todo } of active) {
    lines.push(renderIndexedActiveLine(index, todo, store));
  }

  // Failed (recent 3，含失败原因——修订计划的依据) —— 若上面已按编号含 failed，此处避免重复
  if (failed.length > 3) {
    lines.push(`... 还有 ${failed.length - 3} 条失败`);
  }

  // Completed (last 3)
  if (completed.length > 0) {
    const recent = completed.slice(-3);
    for (const todo of recent) {
      const result = todo.metadata?.result ? `: ${todo.metadata.result}` : '';
      lines.push(`[x] ${todo.subject}${result}`);
    }
    if (completed.length > 3) {
      lines.push(`... 还有 ${completed.length - 3} 条已完成`);
    }
  }

  return lines.join('\n');
}