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
 * 设计要点：把「规划」定义为收到复杂请求后的**第一个动作**，并给同构示例，
 * 让模型把 todo_write 当作多步骤任务的默认起点，而非可选项。
 */
export function createTaskPlanningSection(): SystemPromptSection {
  const content = `【任务规划】

动手之前，先判断这个请求是否需要任务清单。清单会自动展示在上下文中，用户也能实时看到你的计划和进展。

## 必须建清单——收到复杂请求后的第一个动作就是调用 todo_write
以下情况必须立刻规划，不要直接开始做事：
- 需要 3 个以上步骤，或涉及多个文件、多次工具调用
- 实现一个完整功能（写代码、写测试、跑测试验证，每一步都是独立任务）
- 用户提出多项要求，或分阶段的工作（如"先做 A 再做 B"）
- 需要委托子 Agent 执行的工作

## 不需要建清单
- 单个问题、单步小任务、纯问答/分析/闲聊

## 如何推进
- 用 \`todo_write\` 一次传入完整任务列表，恰好一个任务处于 in_progress
- 每完成一步，**立即**用 \`todo_write\` 整表更新状态，不要攒到最后一次性标记
- 需要声明依赖关系时改用 \`todo_create_batch\`（blockedBy）
- 委托子 Agent 时把 todoId 传给 agent 工具，子 Agent 结束后任务状态自动更新，无需再手动更新

## 示例
收到请求："写一个 utils/timestamp.ts，export formatTimestamp(ms) 把时间戳格式化成 YYYY-MM-DD HH:mm:ss，再写单测并跑通。"
第一个动作必须是：
\`\`\`
todo_write({ todos: [
  { subject: "实现 formatTimestamp 函数", status: "in_progress" },
  { subject: "编写对应单测", status: "pending" },
  { subject: "运行测试确认通过", status: "pending" }
] })
\`\`\`
然后按清单推进：做完一步，整表更新一次状态（完成、把下一个置为 in_progress）。`;

  return {
    name: 'task-planning',
    content,
    cacheStrategy: 'static',
    priority: 6,
  };
}
