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

需要 3 个以上步骤、涉及多个文件或多次工具调用、用户提出多项要求、或需要委托子 Agent 时，先用 todo_write 列出计划再动手；清单会自动展示在上下文中，用户也能实时看到进展。单步小任务和纯问答不需要。

复杂请求先调用 submit_plan 呈现完整计划（每步含可执行的完成标准）供用户确认，获批后再动手执行；被拒绝时按反馈修订并重新提交。`;

  return {
    name: 'task-planning',
    content,
    cacheStrategy: 'static',
    priority: 6,
  };
}
