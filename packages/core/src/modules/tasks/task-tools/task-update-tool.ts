import { tool } from 'ai';
import { z } from 'zod';
import type { TaskStore, TaskStatus } from '../types';
import { updateTask } from '../task-update';
import { claimTask } from '../task-claim';

/**
 * TaskUpdateTool - Update a task's properties or status
 * 
 * Supports updating:
 * - Status (to claim, complete, fail, or cancel tasks)
 * - Subject
 * - Active form (current activity description)
 * - Metadata
 */
export const taskUpdateToolSchema = z.object({
  /** Task ID to update (required) */
  id: z.string().describe('The ID of the task to update'),
  /** New status (optional) */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).optional()
    .describe('New task status'),
  /** New subject/title (optional) */
  subject: z.string().optional().describe('New task subject'),
  /** Active form description (optional) - describes what the agent is currently doing */
  activeForm: z.string().nullable().optional()
    .describe('Description of current activity (null to clear)'),
  /** Agent ID claiming this task (optional) - use to claim a task */
  claimedBy: z.string().nullable().optional()
    .describe('Agent ID to claim the task (use with status: in_progress)'),
  /** New blockedBy dependencies (optional) */
  blockedBy: z.array(z.string()).optional()
    .describe('New list of task IDs this task is blocked by'),
  /** Metadata to merge (optional) */
  metadata: z.record(z.string(), z.unknown()).optional()
    .describe('Metadata to merge with existing task metadata'),
});

export type TaskUpdateToolInput = z.infer<typeof taskUpdateToolSchema>;

export type TaskUpdateToolOutput = {
  success: true;
  task: {
    id: string;
    subject: string;
    status: TaskStatus;
    claimedBy: string | null;
    activeForm: string | null;
    blockedBy: string[];
    blocks: string[];
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
    metadata: Record<string, unknown>;
  };
  message?: string;
} | {
  success: false;
  error: string;
};

/**
 * Create a TaskUpdateTool
 * 
 * @param store - The task store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTaskStore();
 * const taskUpdateTool = createTaskUpdateTool(store);
 * 
 * // Update task status
 * const result = await taskUpdateTool.execute({
 *   id: 'task-1',
 *   status: 'completed',
 *   metadata: { result: 'Successfully implemented feature X' }
 * });
 * 
 * // Claim a task
 * const result = await taskUpdateTool.execute({
 *   id: 'task-1',
 *   status: 'in_progress',
 *   claimedBy: 'agent-1',
 *   activeForm: 'Implementing feature X'
 * });
 * ```
 */
export function createTaskUpdateTool(store: TaskStore) {
  return tool({
    description: 'Update a task\'s properties. Use to change status, update metadata, or claim tasks.',
    inputSchema: taskUpdateToolSchema,
    execute: async (input: TaskUpdateToolInput) => {
      try {
        // If claiming (status: in_progress with claimedBy), use claimTask first
        if (input.status === 'in_progress' && input.claimedBy) {
          const claimResult = claimTask(store, input.id, input.claimedBy);
          if (!claimResult.success) {
            return {
              success: false as const,
              error: claimResult.message || 'Failed to claim task',
            };
          }

          // If there's an activeForm, update it
          if (input.activeForm !== undefined) {
            store.updateTask({ id: input.id, activeForm: input.activeForm });
          }

          const updatedTask = store.getTask(input.id);
          if (!updatedTask) {
            return {
              success: false as const,
              error: 'Task not found after claim',
            };
          }

          return {
            success: true as const,
            task: {
              id: updatedTask.id,
              subject: updatedTask.subject,
              status: updatedTask.status,
              claimedBy: updatedTask.claimedBy,
              activeForm: updatedTask.activeForm,
              blockedBy: updatedTask.blockedBy,
              blocks: updatedTask.blocks,
              createdAt: updatedTask.createdAt,
              updatedAt: updatedTask.updatedAt,
              completedAt: updatedTask.completedAt,
              metadata: updatedTask.metadata,
            },
            message: 'Task claimed successfully',
          };
        }

        // Otherwise, do a regular update
        const task = updateTask(store, {
          id: input.id,
          status: input.status,
          subject: input.subject,
          activeForm: input.activeForm,
          claimedBy: input.claimedBy,
          blockedBy: input.blockedBy,
          metadata: input.metadata,
        });

        if (!task) {
          return {
            success: false as const,
            error: `Task ${input.id} not found`,
          };
        }

        return {
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
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
