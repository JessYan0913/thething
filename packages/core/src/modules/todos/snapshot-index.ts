/**
 * Snapshot Index - 稳定编号的唯一来源
 *
 * 方案 C（轻量化，docs/todos-lite.md §3.2）：编号 = **创建序稳定号**，永不重排、永不复用。
 * 每行在「全会话清单」里按 createdAt ASC（id 决胜）占一个固定序号——第 N 次创建 = #N。
 * 完成/取消只是移出**活跃视图**（挪"已收尾"区），不占用活跃位、不使其他行前移。
 * 因此 `[#3]` 在任何时刻都指向同一件事——即使 #1、#2 已收尾。
 *
 * 所有渲染方（权威台账 / todo-overview / compact snapshot / todo_write 输出）
 * 都必须传入**全量**会话清单（getTodosByConversation 原始返回，含终态行），
 * 编号才稳定；传入过滤子集等于自行截断创建序，会得出漂移的编号。
 *
 * 已完成/已取消是终态历史，不占用活跃编号、不参与活跃引用。
 */

import type { Todo, TodoStore } from './types';

/** 活跃状态（参与编号引用） */
const ACTIVE_STATUSES = new Set(['pending', 'in_progress', 'failed']);

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

export type IndexedActiveTodo = {
  /** 1-based 稳定编号（创建序快照号），agent 用它引用/合并 */
  index: number;
  todo: Todo;
};

/**
 * 创建序稳定编号表：对**全量**会话行（含终态）按 createdAt ASC、id 决胜赋 1-based 号。
 * 编号只随「新行创建」追加，不随状态流转、不随收尾前移——
 * 完成 #1 后活跃项仍是原编号（可能稀疏：#2、#4）。
 */
function stableIndexByTodoId(todos: Todo[]): Map<string, number> {
  const sorted = [...todos].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const numById = new Map<string, number>();
  sorted.forEach((t, i) => numById.set(t.id, i + 1));
  return numById;
}

/**
 * 活跃任务的稳定编号视图（所有渲染方共用的唯一编号来源）。
 * 已收尾行不出现，但它们的编号占位保留 → 活跃编号可能稀疏，符合「永不重排」。
 */
export function indexActiveTodos(todos: Todo[]): IndexedActiveTodo[] {
  const numById = stableIndexByTodoId(todos);
  return todos
    .filter((t) => ACTIVE_STATUSES.has(t.status))
    .map((t) => ({ index: numById.get(t.id)!, todo: t }))
    .sort((a, b) => a.index - b.index);
}

/**
 * 按稳定编号解析**全量**行（含终态）。引用已收尾项时（#1 已完成），
 * 这里仍能命中——供 todo_write 对终态引用给出提示（T5），而非报"不存在"。
 */
export function resolveByStableIndex(todos: Todo[], index: number): Todo | undefined {
  const numById = stableIndexByTodoId(todos);
  return todos.find((t) => numById.get(t.id) === index);
}

/**
 * 由稳定编号解析**活跃**任务。已收尾编号命中全量表但这里返回 undefined——
 * 调用方应给出「该编号已收尾」的提示，而不是静默新建/报不存在（T5 落地）。
 */
export function resolveActiveByIndex(todos: Todo[], index: number): Todo | undefined {
  const found = resolveByStableIndex(todos, index);
  return found && ACTIVE_STATUSES.has(found.status) ? found : undefined;
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