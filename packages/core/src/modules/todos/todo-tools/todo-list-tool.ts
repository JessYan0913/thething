import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore, TodoStatus } from '../types';
import { getTodoListResult } from '../todo-available';

/**
 * TodoListTool - List todos with optional filters
 * 
 * Lists todos with support for filtering by status, availability, or agent.
 */
export const todoListToolSchema = z.object({
  /** Filter by todo status (optional) */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).optional()
    .describe('Filter by todo status'),
  /** If true, return only todos available for claiming (optional) */
  available: z.boolean().optional().default(false)
    .describe('Return only todos available for claiming'),
  /** Filter by agent ID (optional) */
  agentId: z.string().optional()
    .describe('Filter by the agent currently working on the todo'),
});

export type TodoListToolInput = z.infer<typeof todoListToolSchema>;

export type TodoListToolOutput = {
  success: true;
  todos: Array<{
    id: string;
    subject: string;
    status: TodoStatus;
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
 * Create a TodoListTool
 * 
 * @param store - The todo store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTodoStore();
 * const todoListTool = createTodoListTool(store);
 * 
 * // List all available todos
 * const result = await todoListTool.execute({ available: true });
 * 
 * // List all pending todos
 * const result = await todoListTool.execute({ status: 'pending' });
 * ```
 */
export function createTodoListTool(store: TodoStore) {
  return tool({
    description: 'List todos with optional filters. Use to find available todos or todos by status.',
    inputSchema: todoListToolSchema,
    execute: async (input: TodoListToolInput) => {
      try {
        const result = getTodoListResult(store, {
          status: input.status,
          available: input.available,
          agentId: input.agentId,
        });

        return {
          success: true as const,
          todos: result.todos.map(todo => ({
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
