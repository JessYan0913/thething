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
 * 设计原则（对齐 claude.com/blog/the-new-rules-of-context-engineering）：
 * 用「原则 + 判断」替代「死规则 + 机械门槛」——不给"三步必须建"这类计数指令，
 * 只给一条判据原则并明确"调研/分析/方案产出型"值得追踪（这正是曾被打跳过的场景）。
 * 工具用法（add 建骨架/#N 更新/status 流转）已在 todo 工具描述中，不在此重复。
 */
export function createTaskPlanningSection(): SystemPromptSection {
  const content = `【任务规划】

todo 清单让分步工作对用户可见、可追踪。**需要拆成多步推进的请求就用它**——特别是"调研/分析/方案"类：即使最终只交付一段文字，"阅读相关代码→定位原因→给出设计方案"本身也值得逐条追踪，别因为"输出是文字"就跳过清单。只有一步能答完的简单询问/纯闲聊才不需要。

建与不建的边界、拆多细、何时 update，按任务的自然结构判断即可，无需请示；具体用法见 todo 工具描述。`;

  return {
    name: 'task-planning',
    content,
    cacheStrategy: 'static',
    priority: 6,
  };
}
