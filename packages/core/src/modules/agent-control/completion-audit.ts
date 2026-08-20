// ============================================================
// Completion Audit — 运行时 quiescent 后的终局判断注入
// ============================================================
// 职责边界（模型决策 / 系统执行）：
// - 系统：仅在运行时 quiescent（无 ready / 无 in_progress / 无待归档重试）时注入一次；
//   只陈述任务状态事实，不做「完成/继续」的业务判断。
// - 模型：读取 Goal + Task State，判断任务是否完成 / 继续 / 阻塞 / 重规划。
//
// 注意：审计的 complete/continue/blocked/replan 决策是模型产物（可读文本即可），
// 不要求普通 Agent / SubAgent 的最终结果使用 JSON（与 FACTS JSON 独立归档同类）。

import type { TodoRuntimeState } from '../todos/todo-runtime';

export type AuditDecision = 'complete' | 'continue' | 'blocked' | 'replan' | 'needs_user';

/** quiescenceReason → 可读原因描述（供 audit 表头）。 */
const REASON_LABEL: Record<string, string> = {
  completed_candidate: '多为已完成、可作完成判断',
  blocked: '被依赖阻塞',
  failed: '存在失败任务',
  no_work: '会话暂无任务',
};

/** 渲染并注入给模型的 Completion Audit 提示。只给结论短钩子，遵守 O(1) context 约束。 */
export function buildCompletionAuditPrompt(
  state: TodoRuntimeState,
  goalObjective?: string,
): string {
  const lines: string[] = [];

  if (goalObjective) {
    lines.push(`## Goal\n${goalObjective}`);
  }

  const reason = state.quiescenceReason ? REASON_LABEL[state.quiescenceReason] ?? state.quiescenceReason : undefined;
  lines.push(
    `## 任务运行时状态（Runtime 已安静：无就绪任务、无进行中任务、无待归档${reason ? `；原因：${reason}` : ''}）`,
  );

  lines.push(`### Ready（可立即执行）\n${renderList(state.ready.map(t => t.subject))}`);
  lines.push(`### In Progress\n${renderList(state.inProgress.map(t => t.subject))}`);
  lines.push(`### Pending（含被依赖阻塞）\n${renderList(state.pending.map(t => t.subject))}`);
  lines.push(`### Failed\n${renderList(state.failed.map(t => t.subject))}`);
  lines.push(`### Recent Completed\n${renderRecent(state.completed)}`);
  lines.push(`### Cancelled\n${renderList(state.cancelled.map(t => t.subject))}`);

  lines.push(
    `<completion-audit>
系统当前没有正在运行的待办工作（runtime 已安静）。请基于上面的任务状态与 Goal 做出最终判断，选择其中一种并在回复中明确说明：

- complete：所有必要任务已完成，Goal 已达成 → 结清所有 in_progress（若有）、提供最终结论并结束。
- continue：仍有未完成任务 → 用 todo_write 创建/恢复相关 Todo，继续执行。
- blocked：当前被外部条件卡住 → 说明阻塞原因并停在这里，等待用户/外部输入。
- replan：目标本身已变化或任务图需要调整 → 用 todo_write 重排任务图后继续。
- needs_user：任务因信息不足/需要用户决策/等待外部输入而挂起 → 用 ask_user_question 明确提问，或说明需要用户介入后停下。
</completion-audit>`,
  );

  return lines.join('\n');
}

function renderList(items: string[]): string {
  if (items.length === 0) return '（无）';
  return items.map((s) => `- ${s}`).join('\n') || '（无）';
}

function renderRecent(completed: TodoRuntimeState['completed']): string {
  const recent = [...completed]
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 10);
  if (recent.length === 0) return '（无）';
  return recent.map((t) => `- ${t.subject}：${summarizeConclusion(t)}`).join('\n');
}

function summarizeConclusion(todo: TodoRuntimeState['completed'][number]): string {
  const meta = todo.metadata ?? {};
  const facts = meta.facts;
  const conclusion = facts && typeof facts === 'object' && typeof (facts as { conclusion?: unknown }).conclusion === 'string'
    ? (facts as { conclusion: string }).conclusion
    : undefined;
  const result = typeof meta.result === 'string' ? meta.result : undefined;
  const text = conclusion ?? result ?? '（无结论）';
  return text.length > 50 ? `${text.slice(0, 50)}…` : text;
}
