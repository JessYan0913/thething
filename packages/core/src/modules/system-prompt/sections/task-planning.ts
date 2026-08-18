import type { SystemPromptSection } from '../types';

// ============================================================================
// Task Planning Section - 任务规划指引（常驻）
// ============================================================================

/**
 * Creates the task planning section for the system prompt.
 * 常驻静态注入：无论当前有没有任务，Agent 都能看到「何时应该规划任务」。
 * （此前该指引写在 todo-overview 内部，导致清单为空时 Agent 完全看不到，
 * 陷入"没创建过任务就不知道要创建任务"的冷启动死循环。）
 *
 * 只保留路由规则（何时建清单的阈值）；具体用法（整表替换、单一 in_progress、
 * blockedBy、todoId 传递）已写在 todo_write / todo_create_batch 工具描述中，
 * 不在此重复。
 */
export function createTaskPlanningSection(): SystemPromptSection {
  const content = `【任务规划】

todo 的作用是拆分复杂任务。当你判断任务有较高复杂度（需要把较大问题拆成子问题，涉及多个方面、有权衡取舍、结果不确定、需要探索或迭代），或打算委托子 Agent 时，你可以考虑先用 todo_write 拆成任务清单再动手——清单会自动展示在上下文中，用户也能实时看到进展。简单直接、一步完成、答案明确的任务通常不需要。

submit_plan 适合用户明确要求先确认计划、或任务高风险（如不可逆操作、对外发送消息）的场景：呈现完整计划（每步含可执行的完成标准）供用户确认。具体用 todo_write 还是 submit_plan、以及是否先动手指南由你结合任务性质自主判断。`;

  return {
    name: 'task-planning',
    content,
    cacheStrategy: 'static',
    priority: 6,
  };
}
