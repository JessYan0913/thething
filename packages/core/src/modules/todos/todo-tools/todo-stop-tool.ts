import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore } from '../types';
import { stopTodo } from '../todo-update';

/**
 * TodoStopTool - Stop a running todo
 * 
 * Stops a todo that is currently in_progress. The todo will be
 * marked as cancelled. Optionally provide a reason for stopping.
 */
export const todoStopToolSchema = z.object({
  /** Todo ID to stop (required) */
  id: z.string().describe('The ID of the todo to stop'),
  /** Reason for stopping (optional) */
  reason: z.string().optional().describe('Reason for stopping the todo'),
});

export type TodoStopToolInput = z.infer<typeof todoStopToolSchema>;

export type TodoStopToolOutput = {
  success: true;
  todo: {
    id: string;
    subject: string;
    status: 'cancelled';
    claimedBy: string | null;
    activeForm: string | null;
    blockedBy: string[];
    blocks: string[];
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
    metadata: Record<string, unknown>;
  };
  message: string;
} | {
  success: false;
  error: string;
};

/**
 * Create a TodoStopTool
 * 
 * @param store - The todo store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTodoStore();
 * const todoStopTool = createTodoStopTool(store);
 * 
 * // Stop a todo
 * const result = await todoStopTool.execute({ 
 *   id: 'todo-1',
 *   reason: 'User requested cancellation'
 * });
 * ```
 */
export function createTodoStopTool(store: TodoStore) {
  return tool({
    description: 'Stop a running todo. Marks the todo as cancelled and frees the agent.',
    inputSchema: todoStopToolSchema,
    execute: async (input: TodoStopToolInput) => {
      try {
        const todo = store.getTodo(input.id);

        if (!todo) {
          return {
            success: false as const,
            error: `Todo ${input.id} not found`,
          };
        }

        if (todo.status !== 'in_progress') {
          return {
            success: false as const,
            error: `Todo ${input.id} is not in progress (current status: ${todo.status})`,
          };
        }

        const updatedTodo = stopTodo(store, input.id, input.reason);

        if (!updatedTodo) {
          return {
            success: false as const,
            error: 'Failed to stop todo',
          };
        }

        return {
          success: true as const,
          todo: {
            id: updatedTodo.id,
            subject: updatedTodo.subject,
            status: updatedTodo.status as 'cancelled',
            claimedBy: updatedTodo.claimedBy,
            activeForm: updatedTodo.activeForm,
            blockedBy: updatedTodo.blockedBy,
            blocks: updatedTodo.blocks,
            createdAt: updatedTodo.createdAt,
            updatedAt: updatedTodo.updatedAt,
            completedAt: updatedTodo.completedAt,
            metadata: updatedTodo.metadata,
          },
          message: input.reason 
            ? `Todo stopped: ${input.reason}` 
            : 'Todo stopped',
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
