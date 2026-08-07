import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore, TodoStatus } from '../types';

/**
 * TodoWriteTool - 整表替换式任务清单管理（主入口，Claude Code TodoWrite 风格）
 *
 * 一次调用传入完整任务列表，工具负责与现有清单对账：
 * - 带 id 且存在 → 更新（subject/status/activeForm）
 * - 不带 id（或 id 不存在）→ 新建
 * - 现有清单中未出现的活跃任务 → 删除
 * - 已完成的 todo 自动保留（作为"已做过什么"的参考，供 overview 展示），
 *   不会被整表替换清掉；如不想保留某条已完成任务，用 todo_delete 取消它。
 *
 * 相比细粒度工具，规划和推进的调用成本接近于零，适合主 Agent 单线程推进。
 * 依赖图（blockedBy）走 todo_create_batch。
 */

const TodoWriteItemSchema = z.object({
  /** 已有任务的 ID（更新时传，新建时省略） */
  id: z.string().optional().describe('Existing todo ID (omit for new todos)'),
  /** 任务标题（祈使句） */
  subject: z.string().min(1).describe('Task title in imperative form'),
  /** 任务状态 */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
    .describe('Task status'),
  /** 进行中时的现在进行时描述 */
  activeForm: z.string().optional()
    .describe('Present-tense label shown while in_progress (e.g. "Running tests")'),
});

export const todoWriteToolSchema = z.object({
  /** 完整任务列表（整表替换语义） */
  todos: z.array(TodoWriteItemSchema).max(20)
    .describe('The FULL todo list. Replaces the current list: existing todos not included here are removed.'),
});

export type TodoWriteToolInput = z.infer<typeof todoWriteToolSchema>;

export type TodoWriteToolOutput = {
  success: true;
  todos: Array<{ id: string; subject: string; status: TodoStatus }>;
  message?: string;
} | {
  success: false;
  error: string;
};

/**
 * Create a TodoWriteTool bound to a conversation
 *
 * @param store - The todo store
 * @param conversationId - The conversation ID to associate todos with
 * @returns The tool definition
 */
export function createTodoWriteToolForConversation(store: TodoStore, conversationId: string) {
  return tool({
    description: `Create and update the task list for the current session. The PREFERRED tool for task planning.

When the user's request involves multiple steps, multiple files, or several tool calls (e.g. write code + tests + run them), your FIRST action should be calling this tool to lay out the plan — do not start working before the list exists.

Usage:
- Pass the FULL list each call; it replaces the previous list (active todos not included are removed; completed ones are kept as a record of what's been done).
- Include the \`id\` for todos you are updating; omit it for new todos.
- Keep exactly one item in_progress at a time; update the list right after each step finishes.
- Skip it only for trivial single-step tasks, pure Q&A, or casual chat.

For dependency graphs (blockedBy), use todo_create_batch instead. When delegating to a sub-agent, pass the todo id as the agent tool's todoId parameter.`,
    inputSchema: todoWriteToolSchema,
    execute: async (input: TodoWriteToolInput) => {
      try {
        const existing = store.getTodosByConversation(conversationId);
        const existingById = new Map(existing.map((t) => [t.id, t]));
        const seenIds = new Set<string>();
        const result: Array<{ id: string; subject: string; status: TodoStatus }> = [];

        const inProgressCount = input.todos.filter((t) => t.status === 'in_progress').length;
        const warning = inProgressCount > 1
          ? `Warning: ${inProgressCount} todos are in_progress. Keep exactly one in_progress at a time.`
          : undefined;

        for (const item of input.todos) {
          if (item.id && existingById.has(item.id)) {
            // 更新已有任务
            const updated = store.updateTodo({
              id: item.id,
              subject: item.subject,
              status: item.status,
              activeForm: item.activeForm ?? null,
            });
            seenIds.add(item.id);
            if (updated) {
              result.push({ id: updated.id, subject: updated.subject, status: updated.status });
            }
          } else {
            // 新建任务（store 创建后默认 pending，需要时再置状态）
            const created = store.createTodo({ conversationId, subject: item.subject });
            if (item.status !== 'pending' || item.activeForm) {
              store.updateTodo({
                id: created.id,
                status: item.status,
                activeForm: item.activeForm ?? null,
              });
            }
            seenIds.add(created.id);
            const final = store.getTodo(created.id) ?? created;
            result.push({ id: final.id, subject: final.subject, status: final.status });
          }
        }

        // 整表替换：删除未出现在本次列表中的活跃任务（已完成任务自动保留）
        for (const todo of existing) {
          if (!seenIds.has(todo.id) && todo.status !== 'completed') {
            store.deleteTodo(todo.id);
          }
        }

        return {
          success: true as const,
          todos: result,
          ...(warning ? { message: warning } : {}),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
