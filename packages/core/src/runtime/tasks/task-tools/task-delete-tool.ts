import { tool } from 'ai';
import { z } from 'zod';
import type { TaskStore } from '../types';
import { deleteTask } from '../task-delete';

/**
 * TaskDeleteTool - Delete a task
 * 
 * Deletes a task and cleans up dependency references.
 * The task must not be in_progress.
 */
export const taskDeleteToolSchema = z.object({
  /** Task ID to delete (required) */
  id: z.string().describe('The ID of the task to delete'),
  /** Force deletion even if task has dependents (optional) */
  force: z.boolean().optional().default(false)
    .describe('Force deletion even if other tasks depend on this task'),
});

export type TaskDeleteToolInput = z.infer<typeof taskDeleteToolSchema>;

export type TaskDeleteToolOutput = {
  success: true;
  deletedId: string;
  message: string;
} | {
  success: false;
  error: string;
};

/**
 * Create a TaskDeleteTool
 * 
 * @param store - The task store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTaskStore();
 * const taskDeleteTool = createTaskDeleteTool(store);
 * 
 * // Delete a task
 * const result = await taskDeleteTool.execute({ id: 'task-1' });
 * ```
 */
export function createTaskDeleteTool(store: TaskStore) {
  return tool({
    description: 'Delete a task. The task must not be in progress.',
    inputSchema: taskDeleteToolSchema,
    execute: async (input: TaskDeleteToolInput) => {
      try {
        const task = store.getTask(input.id);

        if (!task) {
          return {
            success: false as const,
            error: `Task ${input.id} not found`,
          };
        }

        if (task.status === 'in_progress') {
          return {
            success: false as const,
            error: `Cannot delete task ${input.id} while it is in progress. Stop it first.`,
          };
        }

        // Check if task blocks others
        if (!input.force && task.blocks.length > 0) {
          const dependentIds = task.blocks.join(', ');
          return {
            success: false as const,
            error: `Task ${input.id} is blocking other tasks: ${dependentIds}. Use force: true to delete anyway.`,
          };
        }

        const deleted = deleteTask(store, input.id);

        if (!deleted) {
          return {
            success: false as const,
            error: `Failed to delete task ${input.id}`,
          };
        }

        return {
          success: true as const,
          deletedId: input.id,
          message: input.force 
            ? `Task ${input.id} and its ${task.blocks.length} dependent(s) deleted` 
            : `Task ${input.id} deleted`,
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
