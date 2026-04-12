import { tool } from 'ai';
import { z } from 'zod';
import type { TaskStore } from '../types';
import { stopTask } from '../task-update';

/**
 * TaskStopTool - Stop a running task
 * 
 * Stops a task that is currently in_progress. The task will be
 * marked as cancelled. Optionally provide a reason for stopping.
 */
export const taskStopToolSchema = z.object({
  /** Task ID to stop (required) */
  id: z.string().describe('The ID of the task to stop'),
  /** Reason for stopping (optional) */
  reason: z.string().optional().describe('Reason for stopping the task'),
});

export type TaskStopToolInput = z.infer<typeof taskStopToolSchema>;

export type TaskStopToolOutput = {
  success: true;
  task: {
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
 * Create a TaskStopTool
 * 
 * @param store - The task store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTaskStore();
 * const taskStopTool = createTaskStopTool(store);
 * 
 * // Stop a task
 * const result = await taskStopTool.execute({ 
 *   id: 'task-1',
 *   reason: 'User requested cancellation'
 * });
 * ```
 */
export function createTaskStopTool(store: TaskStore) {
  return tool({
    description: 'Stop a running task. Marks the task as cancelled and frees the agent.',
    inputSchema: taskStopToolSchema,
    execute: async (input: TaskStopToolInput) => {
      try {
        const task = store.getTask(input.id);

        if (!task) {
          return {
            success: false as const,
            error: `Task ${input.id} not found`,
          };
        }

        if (task.status !== 'in_progress') {
          return {
            success: false as const,
            error: `Task ${input.id} is not in progress (current status: ${task.status})`,
          };
        }

        const updatedTask = stopTask(store, input.id, input.reason);

        if (!updatedTask) {
          return {
            success: false as const,
            error: 'Failed to stop task',
          };
        }

        return {
          success: true as const,
          task: {
            id: updatedTask.id,
            subject: updatedTask.subject,
            status: updatedTask.status as 'cancelled',
            claimedBy: updatedTask.claimedBy,
            activeForm: updatedTask.activeForm,
            blockedBy: updatedTask.blockedBy,
            blocks: updatedTask.blocks,
            createdAt: updatedTask.createdAt,
            updatedAt: updatedTask.updatedAt,
            completedAt: updatedTask.completedAt,
            metadata: updatedTask.metadata,
          },
          message: input.reason 
            ? `Task stopped: ${input.reason}` 
            : 'Task stopped',
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
