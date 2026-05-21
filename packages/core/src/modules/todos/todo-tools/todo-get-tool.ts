import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore } from '../types';

/**
 * TodoGetTool - Get a single todo by ID
 * 
 * Retrieves detailed information about a specific todo including
 * its dependencies and dependents.
 */
export const todoGetToolSchema = z.object({
  /** Todo ID (required) */
  id: z.string().describe('The ID of the todo to retrieve'),
  /** Include blockedBy todo details (optional) */
  includeBlockedBy: z.boolean().optional().default(false)
    .describe('Include details of blockedBy todos'),
  /** Include blocks (dependent) todo details (optional) */
  includeBlocks: z.boolean().optional().default(false)
    .describe('Include details of todos blocked by this todo'),
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
  /** Details of blockedBy todos (if includeBlockedBy is true) */
  blockedByTodos?: Array<{
    id: string;
    subject: string;
    status: string;
  }>;
  /** Details of blocking (dependent) todos (if includeBlocks is true) */
  blockingTodos?: Array<{
    id: string;
    subject: string;
    status: string;
  }>;
} | {
  success: false;
  error: string;
};

/**
 * Create a TodoGetTool
 * 
 * @param store - The todo store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTodoStore();
 * const todoGetTool = createTodoGetTool(store);
 * 
 * // Get a single todo
 * const result = await todoGetTool.execute({ id: 'todo-1' });
 * 
 * // Get todo with dependency details
 * const result = await todoGetTool.execute({ 
 *   id: 'todo-1',
 *   includeBlockedBy: true,
 *   includeBlocks: true 
 * });
 * ```
 */
export function createTodoGetTool(store: TodoStore) {
  return tool({
    description: 'Get details of a specific todo by ID. Optionally include dependency details.',
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

        const result: TodoGetToolOutput = {
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

        if (input.includeBlockedBy) {
          result.blockedByTodos = todo.blockedBy.map(id => {
            const blockedByTodo = store.getTodo(id);
            return blockedByTodo ? {
              id: blockedByTodo.id,
              subject: blockedByTodo.subject,
              status: blockedByTodo.status,
            } : { id, subject: '[Deleted]', status: 'deleted' };
          });
        }

        if (input.includeBlocks) {
          result.blockingTodos = todo.blocks.map(id => {
            const blockingTodo = store.getTodo(id);
            return blockingTodo ? {
              id: blockingTodo.id,
              subject: blockingTodo.subject,
              status: blockingTodo.status,
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
