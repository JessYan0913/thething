import { tool } from 'ai';
import { z } from 'zod';
import type { TaskStore } from '../types';
import { createTask } from '../task-create';
import { deleteTasks } from '../task-delete';
import { getTasksByStatus } from '../task-available';

/**
 * Clean up old completed tasks for a conversation when creating a new task.
 * This keeps the task list tidy by removing stale completed tasks.
 */
function cleanupOldCompletedTasks(store: TaskStore, conversationId: string): void {
  const completedTasks = getTasksByStatus(store, 'completed').filter(
    (t) => t.conversationId === conversationId
  );
  if (completedTasks.length > 0) {
    deleteTasks(store, completedTasks.map((t) => t.id));
  }
}

export function createTaskCreateTool(store: TaskStore) {
  return tool({
    description: `Create a new task. Use this to create tasks that can be tracked during execution.

IMPORTANT: When you delegate work to a sub-agent (like research tool), pass the returned taskId to the sub-agent as the 'taskId' parameter. The sub-agent will automatically update the task status when completed. You do NOT need to call task_update after the sub-agent finishes.

Example workflow:
1. Call task_create to create a task → returns taskId
2. Call research tool with taskId parameter
3. The research tool will automatically complete the task when done
4. No need to call task_update manually`,
    inputSchema: taskCreateToolSchema,
    execute: async (input: TaskCreateToolInput) => {
      try {
        const convId = input.conversationId || 'default';
        cleanupOldCompletedTasks(store, convId);

        const task = createTask(store, {
          conversationId: convId,
          subject: input.subject,
          blockedBy: input.blockedBy,
          metadata: input.metadata,
        });

        return {
          success: true as const,
          task: {
            id: task.id,
            subject: task.subject,
            status: task.status,
            blockedBy: task.blockedBy,
            blocks: task.blocks,
            createdAt: task.createdAt,
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

/**
 * TaskCreateTool - Create a new task
 * 
 * Creates a new task with optional dependencies and metadata.
 */
export const taskCreateToolSchema = z.object({
  /** Task subject/title (required) */
  subject: z.string().min(1).describe('The task subject/title'),
  /** Conversation ID this task belongs to (required) */
  conversationId: z.string().describe('The conversation ID this task belongs to'),
  /** IDs of tasks this task is blocked by (optional) */
  blockedBy: z.array(z.string()).optional().describe('IDs of tasks this task depends on'),
  /** Task metadata (optional) */
  metadata: z.object({
    /** Priority level */
    priority: z.enum(['low', 'medium', 'high']).optional(),
    /** Tags for categorization */
    tags: z.array(z.string()).optional(),
    /** Any additional data */
  }).passthrough().optional().describe('Additional task metadata'),
});

export type TaskCreateToolInput = z.infer<typeof taskCreateToolSchema>;

export type TaskCreateToolOutput = {
  success: true;
  task: {
    id: string;
    subject: string;
    status: string;
    blockedBy: string[];
    blocks: string[];
    createdAt: number;
    metadata: Record<string, unknown>;
  };
} | {
  success: false;
  error: string;
};

/**
 * Create a TaskCreateTool
 * 
 * @param store - The task store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTaskStore();
 * const taskCreateTool = createTaskCreateTool(store);
 * 
 * const result = await taskCreateTool.execute({
 *   subject: 'Implement user authentication',
 *   blockedBy: ['task-1'], // depends on design task
 *   metadata: { priority: 'high', tags: ['backend', 'security'] }
 * });
 * ```
 */

/**
 * Create a TaskCreateTool with conversation context
 * 
 * @param store - The task store
 * @param conversationId - The conversation ID to associate tasks with
 * @returns The tool definition
 */
export function createTaskCreateToolForConversation(store: TaskStore, conversationId: string) {
  return tool({
    description: `Create a new task. Use this to create tasks that can be tracked during execution.

IMPORTANT: When you delegate work to a sub-agent (like research tool), pass the returned taskId to the sub-agent as the 'taskId' parameter. The sub-agent will automatically update the task status when completed. You do NOT need to call task_update after the sub-agent finishes.

Example workflow:
1. Call task_create to create a task → returns taskId
2. Call research tool with taskId parameter
3. The research tool will automatically complete the task when done
4. No need to call task_update manually`,
    inputSchema: taskCreateToolSchema,
    execute: async (input: TaskCreateToolInput) => {
      try {
        cleanupOldCompletedTasks(store, conversationId);

        const task = createTask(store, {
          conversationId,
          subject: input.subject,
          blockedBy: input.blockedBy,
          metadata: input.metadata,
        });

        return {
          success: true as const,
          task: {
            id: task.id,
            subject: task.subject,
            status: task.status,
            blockedBy: task.blockedBy,
            blocks: task.blocks,
            createdAt: task.createdAt,
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
