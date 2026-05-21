import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore } from '../types';
import { deleteTodo } from '../todo-delete';

/**
 * TodoDeleteTool - Delete a todo
 * 
 * Deletes a todo and cleans up dependency references.
 * The todo must not be in_progress.
 */
export const todoDeleteToolSchema = z.object({
  /** Todo ID to delete (required) */
  id: z.string().describe('The ID of the todo to delete'),
  /** Force deletion even if todo has dependents (optional) */
  force: z.boolean().optional().default(false)
    .describe('Force deletion even if other todos depend on this todo'),
});

export type TodoDeleteToolInput = z.infer<typeof todoDeleteToolSchema>;

export type TodoDeleteToolOutput = {
  success: true;
  deletedId: string;
  message: string;
} | {
  success: false;
  error: string;
};

/**
 * Create a TodoDeleteTool
 * 
 * @param store - The todo store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTodoStore();
 * const todoDeleteTool = createTodoDeleteTool(store);
 * 
 * // Delete a todo
 * const result = await todoDeleteTool.execute({ id: 'todo-1' });
 * ```
 */
export function createTodoDeleteTool(store: TodoStore) {
  return tool({
    description: 'Delete a todo. The todo must not be in progress.',
    inputSchema: todoDeleteToolSchema,
    execute: async (input: TodoDeleteToolInput) => {
      try {
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
            error: `Cannot delete todo ${input.id} while it is in progress. Stop it first.`,
          };
        }

        // Check if todo blocks others
        if (!input.force && todo.blocks.length > 0) {
          const dependentIds = todo.blocks.join(', ');
          return {
            success: false as const,
            error: `Todo ${input.id} is blocking other todos: ${dependentIds}. Use force: true to delete anyway.`,
          };
        }

        const deleted = deleteTodo(store, input.id);

        if (!deleted) {
          return {
            success: false as const,
            error: `Failed to delete todo ${input.id}`,
          };
        }

        return {
          success: true as const,
          deletedId: input.id,
          message: input.force 
            ? `Todo ${input.id} and its ${todo.blocks.length} dependent(s) deleted` 
            : `Todo ${input.id} deleted`,
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
