// ============================================================
// Submit Plan Tool — 计划确认（模型驱动的 plan approval）
// ============================================================
// 走现有 toolApproval 通道（恒 user-approval）：
//   1. 模型调用 submit_plan 呈现完整计划（含 verify 完成标准）
//   2. 审批挂起（approval-requested），前端渲染计划确认卡
//   3. 用户批准 → execute 运行，把计划整表写入 todo store，
//      模型下一轮即通过 todo-overview 看到已获批清单
//   4. 用户拒绝 → SDK 不执行（output-denied），模型直接看到
//      拒绝及原因，据此重新规划
//
// 相比客户端工具 + prepareStep 拦截方案：
// - 复用完整审批基础设施（挂起/恢复/拒绝反馈），零状态机
// - 落库发生在 execute，天然只触发一次

import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore } from '../todos/types';
import type { TodoRuntime } from '../todos/todo-runtime';

// ============================================================
// Schema
// ============================================================

const PlanItemSchema = z.object({
  /** 任务标题（祈使句） */
  subject: z.string().min(1).describe('Task title in imperative form'),
  /** 完成标准（可执行的验证方式） */
  verify: z.string().optional()
    .describe('How to verify this task is done — an executable check where possible (e.g. "npx vitest run src/utils passes")'),
});

export const submitPlanToolSchema = z.object({
  /** 完整计划（整表替换语义：批准后当前活跃 todo 将被这份计划替换） */
  todos: z.array(PlanItemSchema).min(1).max(20)
    .describe('The complete plan. Each item is one task with an optional executable verification. Replaces the current task list when approved.'),
});

export type SubmitPlanToolInput = z.infer<typeof submitPlanToolSchema>;

export type SubmitPlanToolOutput = {
  approved: true;
  created: number;
  message: string;
};

// ============================================================
// Tool
// ============================================================

/**
 * Create the submit_plan tool bound to a conversation.
 *
 * @param store - The todo store
 * @param conversationId - Conversation to write the approved plan into
 */
export function createSubmitPlanTool(store: TodoStore, conversationId: string, runtime?: TodoRuntime) {
  return tool({
    description: `Present a plan for user approval BEFORE executing high-stakes or user-requested-confirmation work. Use ONLY when (a) the user explicitly asked you to show or confirm a plan first, or (b) the work is high-stakes (irreversible actions, sending external messages, deleting data). For ordinary multi-step work, use todo_write instead — do not call this tool for normal multi-step tasks.

The plan becomes the active task list once approved. For simple single-step work or Q&A, skip both this tool and todo_write.

Usage:
- Include every step in the plan, each with a concrete verify (how to check it's done).
- After approval, execute the steps in order and keep the task list updated with todo_write.
- If the user rejects, revise the plan based on their feedback and call this tool again.`,
    inputSchema: submitPlanToolSchema,
    execute: async (input: SubmitPlanToolInput) => {
      // 整表替换：先清掉当前活跃 todo（已完成任务保留；状态迁移经 runtime 取消，留 cancelled 软标记），再写入计划
      const existing = store.getTodosByConversation(conversationId);
      for (const todo of existing) {
        if (todo.status !== 'completed') {
          if (runtime) {
            runtime.cancelTodo(todo.id, 'plan_replaced');
          } else {
            store.deleteTodo(todo.id);
          }
        }
      }

      let created = 0;
      for (const item of input.todos) {
        store.createTodo({
          conversationId,
          subject: item.subject,
          metadata: {
            ...(item.verify ? { verify: item.verify } : {}),
            lifecycle: { createdBy: 'planner' },
          },
        });
        created++;
      }

      return {
        approved: true,
        created,
        message: `Plan approved with ${created} task(s). Execute them in order and keep the task list updated with todo_write.`,
      } satisfies SubmitPlanToolOutput;
    },
  });
}
