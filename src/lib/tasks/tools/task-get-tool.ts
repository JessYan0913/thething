import { tool } from 'ai';
import { z } from 'zod';
import type { TaskStore } from '../types';

/**
 * TaskGetTool - Get a single task by ID
 * 
 * Retrieves detailed information about a specific task including
 * its dependencies and dependents.
 */
export const taskGetToolSchema = z.object({
  /** Task ID (required) */
  id: z.string().describe('The ID of the task to retrieve'),
  /** Include blockedBy task details (optional) */
  includeBlockedBy: z.boolean().optional().default(false)
    .describe('Include details of blockedBy tasks'),
  /** Include blocks (dependent) task details (optional) */
  includeBlocks: z.boolean().optional().default(false)
    .describe('Include details of tasks blocked by this task'),
});

export type TaskGetToolInput = z.infer<typeof taskGetToolSchema>;

export type TaskGetToolOutput = {
  success: true;
  task: {
    id: string;
    subject: string;
    status: string;
    claimedBy: string | null;
    activeForm: string | null;
    blockedBy: string[];
    blocks: string[];
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
    metadata: Record<string, unknown>;
  };
  /** Details of blockedBy tasks (if includeBlockedBy is true) */
  blockedByTasks?: Array<{
    id: string;
    subject: string;
    status: string;
  }>;
  /** Details of blocking (dependent) tasks (if includeBlocks is true) */
  blockingTasks?: Array<{
    id: string;
    subject: string;
    status: string;
  }>;
} | {
  success: false;
  error: string;
};

/**
 * Create a TaskGetTool
 * 
 * @param store - The task store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTaskStore();
 * const taskGetTool = createTaskGetTool(store);
 * 
 * // Get a single task
 * const result = await taskGetTool.execute({ id: 'task-1' });
 * 
 * // Get task with dependency details
 * const result = await taskGetTool.execute({ 
 *   id: 'task-1',
 *   includeBlockedBy: true,
 *   includeBlocks: true 
 * });
 * ```
 */
export function createTaskGetTool(store: TaskStore) {
  return tool({
    description: 'Get details of a specific task by ID. Optionally include dependency details.',
    inputSchema: taskGetToolSchema,
    execute: async (input: TaskGetToolInput) => {
      try {
        const task = store.getTask(input.id);

        if (!task) {
          return {
            success: false as const,
            error: `Task ${input.id} not found`,
          };
        }

        const result: TaskGetToolOutput = {
          success: true as const,
          task: {
            id: task.id,
            subject: task.subject,
            status: task.status,
            claimedBy: task.claimedBy,
            activeForm: task.activeForm,
            blockedBy: task.blockedBy,
            blocks: task.blocks,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            completedAt: task.completedAt,
            metadata: task.metadata,
          },
        };

        if (input.includeBlockedBy) {
          result.blockedByTasks = task.blockedBy.map(id => {
            const blockedByTask = store.getTask(id);
            return blockedByTask ? {
              id: blockedByTask.id,
              subject: blockedByTask.subject,
              status: blockedByTask.status,
            } : { id, subject: '[Deleted]', status: 'deleted' };
          });
        }

        if (input.includeBlocks) {
          result.blockingTasks = task.blocks.map(id => {
            const blockingTask = store.getTask(id);
            return blockingTask ? {
              id: blockingTask.id,
              subject: blockingTask.subject,
              status: blockingTask.status,
            } : { id, subject: '[Deleted]', status: 'deleted' };
          });
        }

        return result;
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
