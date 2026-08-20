/**
 * Snapshot Index - active-todo 的唯一编号来源
 *
 * 方案 C：agent 靠"快照序号"定位任务。本模块是唯一的事实来源——
 * 所有渲染方（权威台账 / todo-overview / compact snapshot / todo_write 输出）
 * 都通过 `indexActiveTodos` 对**活跃**任务（pending/in_progress/failed）赋
 * 1-based 编号，保证 agent 在任何一个界面看到的 `[N]` 都是同一个任务。
 *
 * 排序：按 createdAt ASC（稳定、可预期）。只随任务的**创建/取消**改变，
 * 不随状态流转（pending→in_progress→completed）漂移——这是"先看清单再操作"
 * 能在多轮推进中保持可引用的关键。
 *
 * 已完成/已取消是终态历史，不占用活跃编号、不参与引用。
 */

import type { Todo, TodoStore } from './types';

/** 活跃状态（参与编号引用 / 参与真替换判定） */
const ACTIVE_STATUSES = new Set(['pending', 'in_progress', 'failed']);

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

export type IndexedActiveTodo = {
  /** 1-based 活跃编号（快照序号），agent 用它引用/合并 */
  index: number;
  todo: Todo;
};

/**
 * 对活跃任务按 createdAt ASC 赋 1-based 编号。
 * 所有渲染方共用，保证编号全一致性。
 */
export function indexActiveTodos(todos: Todo[]): IndexedActiveTodo[] {
  return todos
    .filter((t) => ACTIVE_STATUSES.has(t.status))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((todo, i) => ({ index: i + 1, todo }));
}

/**
 * 由活跃编号解析出对应任务。越界/不存在 → undefined。
 * 调用方（todo_write）对 undefined 应报错而非静默新建，逼 agent 重读清单。
 */
export function resolveActiveByIndex(todos: Todo[], index: number): Todo | undefined {
  return indexActiveTodos(todos).find((e) => e.index === index)?.todo;
}

/**
 * 解析模型委托时传来的"任务引用"（`[#N]` 编号 或 精确标题）到内部活跃 todo id。
 *
 * 用途：子 Agent 委托（agent-tool / parallel-agent-tool）把模型可见的标题/编号
 * 解析成程序内部 id，供 Path B 自动置 in_progress / complete / fail。
 * 注意：这是"定位目标行以便状态同步"，**不是去重**——标题按规范化精确匹配单一活跃项；
 * 无匹配时返回 undefined（委托照常执行，只是不做自动状态同步）。
 * 模型面永不读写原始 id（方案 C）。
 */
export function resolveTodoReference(
  store: Pick<TodoStore, 'getTodosByConversation'>,
  conversationId: string,
  ref: string,
): string | undefined {
  const todos = store.getTodosByConversation(conversationId);
  const norm = ref.trim();

  const idxMatch = norm.match(/^\[?#?\s*(#?\s*\d+)\]?$/);
  if (idxMatch) {
    const n = Number(idxMatch[1].replace('#', '').trim());
    const byIndex = resolveActiveByIndex(todos, n);
    if (byIndex) return byIndex.id;
  }

  const subject = norm.replace(/^\[#\d+\]\s*/, '').trim().toLowerCase();
  if (subject) {
    const bySubject = todos.find(
      (t) => isActiveStatus(t.status) && t.subject.trim().toLowerCase() === subject,
    );
    if (bySubject) return bySubject.id;
  }

  return undefined;
}
