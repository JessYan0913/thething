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
 * 只保留路由规则（何时建清单的阈值）；具体用法（#N 引用、批量 add、status 流转）
 * 已写在 todo 工具描述中，不在此重复。
 */
export function createTaskPlanningSection(): SystemPromptSection {
  const content = `【任务规划】

todo 用来把复杂工作拆成可追踪的步骤。遇到以下情况时先建立任务清单：涉及多个文件的探索或调查、需要先调研再实施、有多轮工具调用、或用户明确要求"做规划/拆步骤"。清单建立后每完成一步立即更新对应任务，用户能在任务面板实时看到进展。简单直接、一步完成、答案明确的任务不需要建清单。

- **动手前一次性建齐骨架**：先用 todo 的 add 一次传入完整任务列表（items[]，步骤间依赖提示用 dependsOnSteps），建完骨架再开始执行。
- **之后只更新，不重建**：每完成一步用 todo 的 update 按 #N 只更新对应任务的状态；已在清单里的任务不要再次当新建传入，只有新增职责时才新建任务——清单始终反映真实意图。

submit_plan 适合用户明确要求先确认计划、或任务高风险（如不可逆操作、对外发送消息）的场景：呈现完整计划（每步含可执行的完成标准）供用户确认。具体用 todo 还是 submit_plan 由你结合任务性质自主判断。`;

  return {
    name: 'task-planning',
    content,
    cacheStrategy: 'static',
    priority: 6,
  };
}
