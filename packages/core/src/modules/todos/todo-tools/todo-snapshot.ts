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
  const completed = todos.filter(t => t.status === 'completed');

  // Stats line
  const stats = [
    inProgress.length > 0 ? `进行中: ${inProgress.length}` : '',
    pending.length > 0 ? `待办: ${pending.length}` : '',
    completed.length > 0 ? `已完成: ${completed.length}` : '',
  ].filter(Boolean).join(' | ');

  if (stats) {
    lines.push(`[任务清单] ${stats}`);
  }

  // In progress
  for (const todo of inProgress) {
    const active = todo.activeForm ? ` — ${todo.activeForm}` : '';
    const owner = todo.claimedBy ? ` (${todo.claimedBy})` : '';
    lines.push(`[→] #${todo.id} ${todo.subject}${active}${owner}`);
  }

  // Pending (unblocked first)
  const unblocked = pending.filter(t => t.blockedBy.length === 0);
  const blocked = pending.filter(t => t.blockedBy.length > 0);

  for (const todo of unblocked) {
    lines.push(`[ ] #${todo.id} ${todo.subject}`);
  }
  for (const todo of blocked) {
    const depNames = todo.blockedBy.map(id => {
      const dep = store.getTodo(id);
      return dep ? `#${dep.id} ${dep.subject}` : `#${id} (已删除)`;
    });
    lines.push(`[ ] #${todo.id} ${todo.subject} (被 ${depNames.join(', ')} 阻塞)`);
  }

  // Completed (last 3)
  if (completed.length > 0) {
    const recent = completed.slice(-3);
    for (const todo of recent) {
      const result = todo.metadata?.result ? `: ${todo.metadata.result}` : '';
      lines.push(`[x] #${todo.id} ${todo.subject}${result}`);
    }
    if (completed.length > 3) {
      lines.push(`... 还有 ${completed.length - 3} 条已完成`);
    }
  }

  return lines.join('\n');
}