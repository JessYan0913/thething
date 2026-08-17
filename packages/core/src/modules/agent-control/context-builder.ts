// ============================================================
// Context Builder - 子任务独立上下文范式（Task Paradigm Redesign §4）
// ============================================================
// 每子任务边界重建消息：索引池（已完成摘要，上限 50 条）+ 当前子任务 + 读回指针。
// 不继承上一子任务的原始日志——跨子任务只共享结论摘要，上下文规模 O(1)。
// 见 docs/task-paradigm-redesign.md §4.3。

import type { Todo } from '../todos/types';

/** 索引池上限（O(1) 保证：50 条 × ~40 tokens ≈ 2,000 tokens） */
export const INDEX_POOL_LIMIT = 50;
/** 索引行结论截断长度（字符） */
export const CONCLUSION_SNIPPET_MAX = 50;

/** 从 todo 提取结论：优先 facts.conclusion，回退 metadata.result 字符串 */
function extractConclusion(todo: Todo): string | null {
  const facts = (todo.metadata as Record<string, unknown>).facts;
  if (
    facts &&
    typeof facts === 'object' &&
    typeof (facts as { conclusion?: unknown }).conclusion === 'string'
  ) {
    const c = (facts as { conclusion: string }).conclusion;
    if (c.trim()) return c;
  }
  if (typeof todo.metadata.result === 'string' && todo.metadata.result.trim()) {
    return todo.metadata.result;
  }
  return null;
}

/** 截断结论为短钩子，末尾省略号标记（防止索引行嵌入完整结论破坏 O(1)） */
function snippet(text: string, max = CONCLUSION_SNIPPET_MAX): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+$/, '') + '…';
}

/** 当前子任务：优先 in_progress，否则下一个未阻塞 pending，否则 null */
export function getCurrentTodo(todos: Todo[]): Todo | null {
  const inProgress = todos.find((t) => t.status === 'in_progress');
  if (inProgress) return inProgress;
  const pending = todos
    .filter((t) => t.status === 'pending')
    .sort((a, b) => Number(a.blockedBy.length) - Number(b.blockedBy.length));
  return pending[0] ?? null;
}

/** 已完成且有结论的子任务，按 completedAt DESC（供索引池构建 + 条数统计复用） */
function completedWithConclusion(todos: Todo[]): Array<{ t: Todo; conclusion: string }> {
  return todos
    .filter((t) => t.status === 'completed')
    .map((t) => ({ t, conclusion: extractConclusion(t) }))
    .filter((x): x is { t: Todo; conclusion: string } => x.conclusion !== null)
    .sort((a, b) => (b.t.completedAt ?? 0) - (a.t.completedAt ?? 0));
}

/**
 * 构建索引池文本（已完成摘要，按 completedAt DESC，上限 50 条）。
 * 返回 null 表示无已完成的子任务。
 */
export function buildCompletedTodoIndex(todos: Todo[], limit = INDEX_POOL_LIMIT): string | null {
  const completed = completedWithConclusion(todos).slice(0, limit);

  if (completed.length === 0) return null;

  return completed
    .map(({ t, conclusion }, i) => `[已完成] ${i + 1}. ${t.subject}：${snippet(conclusion)}`)
    .join('\n');
}

/** 索引池条数（0-50），供 index_pool_updated 遥测上抛 */
export function getIndexPoolSize(todos: Todo[], limit = INDEX_POOL_LIMIT): number {
  return completedWithConclusion(todos).slice(0, limit).length;
}

/**
 * 组装子任务上下文消息（每子任务边界重建；不继承上一子任务原始日志）。
 * 返回新的消息数组 = [索引池 + 当前子任务 + 读回指针] 的 user 消息。
 * 系统指令由调用方（prepareStep）另行处理。
 */
export function buildSubtaskContext(todos: Todo[]): import('ai').ModelMessage[] {
  const index = buildCompletedTodoIndex(todos);
  const current = getCurrentTodo(todos);

  const sections: string[] = [];
  if (index) {
    sections.push(`[已完成子任务索引]\n${index}`);
  }
  if (current) {
    const verify = current.metadata?.verify ? `\n完成标准: ${current.metadata.verify}` : '';
    sections.push(`[当前子任务] ${current.subject}${verify}`);
  }
  sections.push(
    '[提示] 如需查看某条完整结论/关键事实/原始日志，调用 todo_list({ id: "..." }) 获取完整详情。',
  );

  return [{ role: 'user', content: sections.join('\n\n') }];
}
