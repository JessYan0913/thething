import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore } from '../types';

/**
 * TodoGetTool - Get a single todo's full details
 *
 * Returns the complete todo object including all fields.
 * Use this when you need the full context of a specific task:
 * - Full description, result, error details
 * - Timestamps (created, updated, completed)
 * - Dependencies (blockedBy, blocks)
 * - Metadata (priority, tags, etc.)
 */
export const todoGetToolSchema = z.object({
  /** Todo ID to get details for */
  id: z.string().describe('The ID of the todo to get details for'),
});

export type TodoGetToolInput = z.infer<typeof todoGetToolSchema>;

export type TodoGetToolOutput = {
  success: true;
  todo: {
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
} | {
  success: false;
  error: string;
};

/**
 * Create a TodoGetTool
 *
 * @param store - The todo store
 * @returns The tool definition
 */
export function createTodoGetTool(store: TodoStore) {
  return tool({
    description: 'Get the full details of a specific todo by ID. Returns complete information including description, timestamps, dependencies, metadata, and result. Use this when you need the full context of a task, especially to reference the `result` of a completed task as input for subsequent steps.',
    inputSchema: todoGetToolSchema,
    execute: async (input: TodoGetToolInput) => {
      try {
        const todo = store.getTodo(input.id);

        if (!todo) {
          return {
            success: false as const,
            error: `Todo ${input.id} not found`,
          };
        }

        return {
          success: true as const,
          todo: {
            id: todo.id,
            subject: todo.subject,
            status: todo.status,
            claimedBy: todo.claimedBy,
            activeForm: todo.activeForm,
            blockedBy: todo.blockedBy,
            blocks: todo.blocks,
            createdAt: todo.createdAt,
            updatedAt: todo.updatedAt,
            completedAt: todo.completedAt,
            metadata: todo.metadata,
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