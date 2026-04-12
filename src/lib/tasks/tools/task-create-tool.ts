import { tool } from 'ai';
import { z } from 'zod';
import type { TaskStore } from '../types';
import { createTask } from '../task-create';

/**
 * TaskCreateTool - Create a new task
 * 
 * Creates a new task with optional dependencies and metadata.
 */
export const taskCreateToolSchema = z.object({
  /** Task subject/title (required) */
  subject: z.string().min(1).describe('The task subject/title'),
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
export function createTaskCreateTool(store: TaskStore) {
  return tool({
    description: 'Create a new task. Use this to create tasks that can be claimed by agents.',
    inputSchema: taskCreateToolSchema,
    execute: async (input: TaskCreateToolInput) => {
      try {
        const task = createTask(store, {
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
