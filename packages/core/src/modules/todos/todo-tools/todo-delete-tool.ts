import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore } from '../types';
import { updateTodo } from '../todo-update';
import { deleteTodoWithDependents } from '../todo-delete';
import { resolveActiveByIndex } from '../snapshot-index';
import type { TodoRuntime } from '../todo-runtime';

/**
 * TodoDeleteTool - Soft-delete (cancel) a todo
 *
 * 方案 C：按快照序号（index）定位，不传 id。同会话活跃任务编号与 todo_write/清单一致。
 * Marks a todo as cancelled instead of actually deleting it.
 * The todo must not be in_progress. Use cascade to also delete dependents.
 */
export const todoDeleteToolSchema = z.object({
  /** 要取消的活跃任务序号（对应清单里的 [#N]） */
  index: z.number().int().positive().describe('Index (1-based) of the active task to cancel, as shown in the task list like [#3].'),
  /** Force cancellation even if todo has dependents (optional) */
  force: z.boolean().optional().default(false)
    .describe('Force cancel even if other todos depend on this todo'),
  /** Cascade delete: also delete all dependent todos (optional) */
  cascade: z.boolean().optional().default(false)
    .describe('Also delete all dependent todos (cascade). WARNING: This permanently deletes all dependent todos.'),
});

export type TodoDeleteToolInput = z.infer<typeof todoDeleteToolSchema>;

export type TodoDeleteToolOutput = {
  success: true;
  cancelledId: string;
  message: string;
} | {
  success: false;
  error: string;
};

/**
 * Create a TodoDeleteTool bound to a conversation for index-based deletion.
 *
 * @param store - The todo store
 * @param conversationId - The conversation whose active todo indices we resolve against
 */
export function createTodoDeleteTool(store: TodoStore, conversationId: string, runtime?: TodoRuntime) {
  return tool({
    description: 'Cancel a todo (soft delete) by its list index. Marks it as cancelled instead of removing it. The todo must not be in progress. Use cascade: true to permanently delete this todo and all of its dependent todos.',
    inputSchema: todoDeleteToolSchema,
    execute: async (input: TodoDeleteToolInput) => {
      try {
        const todos = store.getTodosByConversation(conversationId);
        const target = resolveActiveByIndex(todos, input.index);

        if (!target) {
          return {
            success: false as const,
            error: `index ${input.index} does not match any active task. Re-read the latest task list and retry.`,
          };
        }

        // Cascade delete: permanently delete this todo and all its dependents
        if (input.cascade) {
          const deletedIds = deleteTodoWithDependents(store, target.id);
          return {
            success: true as const,
            cancelledId: target.id,
            message: `Deleted ${deletedIds.length} todos (cascade): ${deletedIds.join(', ')}`,
          };
        }

        if (target.status === 'in_progress') {
          return {
            success: false as const,
            error: `Cannot cancel todo #${input.index} while it is in progress. Stop it first.`,
          };
        }

        // Check if todo blocks others
        if (!input.force && target.blocks.length > 0) {
          const dependentIds = target.blocks.join(', ');
          return {
            success: false as const,
            error: `Todo #${input.index} is blocking other todos: ${dependentIds}. Use force: true to cancel anyway.`,
          };
        }

        const updated = runtime
          ? runtime.cancelTodo(target.id, 'deleted')
          : updateTodo(store, {
              id: target.id,
              status: 'cancelled',
            });

        if (!updated) {
          return {
            success: false as const,
            error: `Failed to cancel todo #${input.index}`,
          };
        }

        return {
          success: true as const,
          cancelledId: target.id,
          message: `Todo #${input.index} cancelled`,
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
