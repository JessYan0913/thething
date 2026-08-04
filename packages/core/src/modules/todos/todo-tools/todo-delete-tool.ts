import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore } from '../types';
import { updateTodo } from '../todo-update';
import { deleteTodoWithDependents } from '../todo-delete';

/**
 * TodoDeleteTool - Soft-delete (cancel) a todo
 *
 * Marks a todo as cancelled instead of actually deleting it.
 * This preserves dependency integrity and history.
 * The todo must not be in_progress.
 *
 * Use cascade: true to also delete all dependent todos.
 */
export const todoDeleteToolSchema = z.object({
  /** Todo ID to cancel (required) */
  id: z.string().describe('The ID of the todo to cancel (soft-delete)'),
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
 * Create a TodoDeleteTool
 *
 * Soft-deletes a todo by marking it as cancelled.
 * This preserves dependency relationships and history.
 *
 * @param store - The todo store
 * @returns The tool definition
 *
 * @example
 * ```typescript
 * const store = createTodoStore();
 * const todoDeleteTool = createTodoDeleteTool(store);
 *
 * // Cancel a todo
 * const result = await todoDeleteTool.execute({ id: 'todo-1' });
 * ```
 */
export function createTodoDeleteTool(store: TodoStore) {
  return tool({
    description: 'Cancel a todo (soft delete). Marks it as cancelled instead of removing it. The todo must not be in progress. Use cascade: true to permanently delete this todo and all of its dependent todos.',
    inputSchema: todoDeleteToolSchema,
    execute: async (input: TodoDeleteToolInput) => {
      try {
        // Cascade delete: permanently delete this todo and all its dependents
        if (input.cascade) {
          const deletedIds = deleteTodoWithDependents(store, input.id);
          return {
            success: true as const,
            cancelledId: input.id,
            message: `Deleted ${deletedIds.length} todos (cascade): ${deletedIds.join(', ')}`,
          };
        }

        const todo = store.getTodo(input.id);

        if (!todo) {
          return {
            success: false as const,
            error: `Todo ${input.id} not found`,
          };
        }

        if (todo.status === 'in_progress') {
          return {
            success: false as const,
            error: `Cannot cancel todo ${input.id} while it is in progress. Stop it first.`,
          };
        }

        // Check if todo blocks others
        if (!input.force && todo.blocks.length > 0) {
          const dependentIds = todo.blocks.join(', ');
          return {
            success: false as const,
            error: `Todo ${input.id} is blocking other todos: ${dependentIds}. Use force: true to cancel anyway.`,
          };
        }

        // Soft delete: mark as cancelled
        const updated = updateTodo(store, {
          id: input.id,
          status: 'cancelled',
        });

        if (!updated) {
          return {
            success: false as const,
            error: `Failed to cancel todo ${input.id}`,
          };
        }

        return {
          success: true as const,
          cancelledId: input.id,
          message: `Todo ${input.id} cancelled`,
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