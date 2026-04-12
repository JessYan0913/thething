import { tool } from 'ai';
import { z } from 'zod';
import type { TaskStore, TaskStatus } from '../types';
import { getTaskListResult } from '../task-available';

/**
 * TaskListTool - List tasks with optional filters
 * 
 * Lists tasks with support for filtering by status, availability, or agent.
 */
export const taskListToolSchema = z.object({
  /** Filter by task status (optional) */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).optional()
    .describe('Filter by task status'),
  /** If true, return only tasks available for claiming (optional) */
  available: z.boolean().optional().default(false)
    .describe('Return only tasks available for claiming'),
  /** Filter by agent ID (optional) */
  agentId: z.string().optional()
    .describe('Filter by the agent currently working on the task'),
});

export type TaskListToolInput = z.infer<typeof taskListToolSchema>;

export type TaskListToolOutput = {
  success: true;
  tasks: Array<{
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
  }>;
  total: number;
} | {
  success: false;
  error: string;
};

/**
 * Create a TaskListTool
 * 
 * @param store - The task store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTaskStore();
 * const taskListTool = createTaskListTool(store);
 * 
 * // List all available tasks
 * const result = await taskListTool.execute({ available: true });
 * 
 * // List all pending tasks
 * const result = await taskListTool.execute({ status: 'pending' });
 * ```
 */
export function createTaskListTool(store: TaskStore) {
  return tool({
    description: 'List tasks with optional filters. Use to find available tasks or tasks by status.',
    inputSchema: taskListToolSchema,
    execute: async (input: TaskListToolInput) => {
      try {
        const result = getTaskListResult(store, {
          status: input.status,
          available: input.available,
          agentId: input.agentId,
        });

        return {
          success: true as const,
          tasks: result.tasks.map(task => ({
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
          })),
          total: result.total,
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
