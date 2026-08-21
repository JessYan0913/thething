/**
 * Todo Overview Section - 自动注入任务清单到系统提示
 *
 * 在系统提示中添加当前会话的任务清单，让 Agent 无需通过工具调用即可看到任务。
 * 同时包含任务规划指导，告诉 Agent 何时应该创建子任务、如何推进。
 */

import type { SystemPromptSection } from '../types';
import type { TodoStore, Todo } from '../../todos/types';
import { indexActiveTodos, renderIndexedActiveLine } from '../../todos';

/**
 * Maximum number of todos to display in the overview
 */
const MAX_TODOS = 20;

/**
 * Maximum number of recent completed todos to show
 */
const MAX_RECENT_COMPLETED = 3;

/**
 * 创建任务清单系统提示段
 *
 * 从 TodoStore 中读取当前会话的任务，格式化为易读的清单，
 * 自动注入到系统提示中。不包含 todoStore 或 conversationId 时返回 null content。
 */
export function createTodoOverviewSection(
  todoStore?: TodoStore,
  conversationId?: string,
): SystemPromptSection {
  if (!todoStore || !conversationId) {
    return {
      name: 'todo-overview',
      content: null,
      cacheStrategy: 'dynamic',
      priority: 52,
    };
  }

  const todos = todoStore.getTodosByConversation(conversationId);
  if (todos.length === 0) {
    return {
      name: 'todo-overview',
      content: null,
      cacheStrategy: 'dynamic',
      priority: 52,
    };
  }

  const content = buildTodoOverview(todos, todoStore);
  return {
    name: 'todo-overview',
    content,
    cacheStrategy: 'dynamic',
    priority: 52,
  };
}

// ============================================================================
// Formatting
// ============================================================================

function buildTodoOverview(todos: Todo[], store: TodoStore): string {
  const lines: string[] = [];

  // 规划指引常驻在 task-planning section，这里只渲染清单本身
  lines.push('## 📋 当前任务清单');
  lines.push('');

  // 统计概览
  const inProgress = todos.filter(t => t.status === 'in_progress');
  const pending = todos.filter(t => t.status === 'pending');
  const completed = todos.filter(t => t.status === 'completed');
  const failed = todos.filter(t => t.status === 'failed');
  const cancelled = todos.filter(t => t.status === 'cancelled');

  const statsParts: string[] = [];
  if (inProgress.length > 0) statsParts.push(`进行中: ${inProgress.length}`);
  if (pending.length > 0) statsParts.push(`待办: ${pending.length}`);
  if (completed.length > 0) statsParts.push(`已完成: ${completed.length}`);
  if (failed.length > 0) statsParts.push(`失败: ${failed.length}`);
  if (cancelled.length > 0) statsParts.push(`已取消: ${cancelled.length}`);

  if (statsParts.length > 0) {
    lines.push(statsParts.join(' | '));
    lines.push('');
  }

  // 活跃任务统一编号（创建时物化的 todo.number，永不复用/重排），与 todo 工具输出/
  // 快照/台账共用同一编号——agent 据此引用 [#N]（D2）。分组渲染但编号全局一致。
  const active = indexActiveTodos(todos);
  const byId = new Map(active.map(({ index, todo }) => [todo.id, index]));

  // 进行中任务
  if (inProgress.length > 0) {
    lines.push('### 进行中');
    for (const todo of inProgress) {
      const idx = byId.get(todo.id);
      lines.push(idx !== undefined ? renderIndexedActiveLine(idx, todo, store) : formatTodoLine(todo, store));
    }
    lines.push('');
  }

  // 可领取的待办（无依赖且 pending）
  const available = pending.filter(t => t.blockedBy.length === 0);
  if (available.length > 0) {
    lines.push('### 待办（可领取）');
    const shown = available.slice(0, MAX_TODOS);
    for (const todo of shown) {
      const idx = byId.get(todo.id);
      lines.push(idx !== undefined ? renderIndexedActiveLine(idx, todo, store) : formatTodoLine(todo, store));
    }
    if (available.length > MAX_TODOS) {
      lines.push(`... 还有 ${available.length - MAX_TODOS} 条`);
    }
    lines.push('');
  }

  // 有依赖的待办
  const blocked = pending.filter(t => t.blockedBy.length > 0);
  if (blocked.length > 0) {
    lines.push('### 待办（有依赖）');
    const shown = blocked.slice(0, MAX_TODOS);
    for (const todo of shown) {
      const idx = byId.get(todo.id);
      lines.push(idx !== undefined ? renderIndexedActiveLine(idx, todo, store) : formatTodoLine(todo, store));
    }
    if (blocked.length > MAX_TODOS) {
      lines.push(`... 还有 ${blocked.length - MAX_TODOS} 条`);
    }
    lines.push('');
  }

  // 最近完成
  if (completed.length > 0) {
    const recent = completed
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, MAX_RECENT_COMPLETED);
    lines.push('### 最近完成');
    for (const todo of recent) {
      lines.push(formatTodoLine(todo, store));
    }
    if (completed.length > MAX_RECENT_COMPLETED) {
      lines.push(`... 还有 ${completed.length - MAX_RECENT_COMPLETED} 条已完成`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

function formatTodoLine(todo: Todo, store: TodoStore): string {
  const parts: string[] = [];

  // 优先级标记
  const priority = todo.metadata?.priority;
  if (priority === 'high') {
    parts.push('⚡');
  }

  // 标题（非活跃行如已完成/取消不编号——编号只给 agent 当前可引用的活跃任务）
  parts.push(todo.subject);

  // 认领人标记
  if (todo.claimedBy) {
    parts.push(`(${todo.claimedBy})`);
  }

  // 完成标准（未完结任务展示，提示按此验证）
  if (todo.metadata?.verify && (todo.status === 'pending' || todo.status === 'in_progress')) {
    parts.push(`(verify: ${todo.metadata.verify})`);
  }

  // 完成标记
  if (todo.status === 'completed') {
    const result = todo.metadata?.result ? `: ${todo.metadata.result}` : '';
    parts.push(`✅${result}`);
  }

  // 失败标记
  if (todo.status === 'failed') {
    const error = todo.metadata?.error ? `: ${todo.metadata.error}` : '';
    parts.push(`❌${error}`);
  }

  // 取消标记
  if (todo.status === 'cancelled') {
    parts.push('🚫');
  }

  // 已取消的任务整体画横线
  const prefix = todo.status === 'cancelled' ? '~~' : '';
  const suffix = todo.status === 'cancelled' ? '~~' : '';

  return `- ${prefix}${parts.join(' ')}${suffix}`;
}