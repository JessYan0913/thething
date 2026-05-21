import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore } from '../types';
import { createTodo } from '../todo-create';
import { deleteTodos } from '../todo-delete';
import { getTodosByStatus } from '../todo-available';

/**
 * Clean up old completed todos for a conversation when creating a new todo.
 * This keeps the todo list tidy by removing stale completed todos.
 */
function cleanupOldCompletedTodos(store: TodoStore, conversationId: string): void {
  const completedTodos = getTodosByStatus(store, 'completed').filter(
    (t) => t.conversationId === conversationId
  );
  if (completedTodos.length > 0) {
    deleteTodos(store, completedTodos.map((t) => t.id));
  }
}

export function createTodoCreateTool(store: TodoStore) {
  return tool({
    description: `Create a new todo. Use this to create todos that can be tracked during execution.

IMPORTANT: When you delegate work to a sub-agent (like research tool), pass the returned todoId to the sub-agent as the 'todoId' parameter. The sub-agent will automatically update the todo status when completed. You do NOT need to call todo_update after the sub-agent finishes.

Example workflow:
1. Call todo_create to create a todo → returns todoId
2. Call research tool with todoId parameter
3. The research tool will automatically complete the todo when done
4. No need to call todo_update manually`,
    inputSchema: todoCreateToolSchema,
    execute: async (input: TodoCreateToolInput) => {
      try {
        const convId = input.conversationId || 'default';
        cleanupOldCompletedTodos(store, convId);

        const todo = createTodo(store, {
          conversationId: convId,
          subject: input.subject,
          blockedBy: input.blockedBy,
          metadata: input.metadata,
        });

        return {
          success: true as const,
          todo: {
            id: todo.id,
            subject: todo.subject,
            status: todo.status,
            blockedBy: todo.blockedBy,
            blocks: todo.blocks,
            createdAt: todo.createdAt,
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

/**
 * TodoCreateTool - Create a new todo
 * 
 * Creates a new todo with optional dependencies and metadata.
 */
export const todoCreateToolSchema = z.object({
  /** Todo subject/title (required) */
  subject: z.string().min(1).describe('The todo subject/title'),
  /** Conversation ID this todo belongs to (required) */
  conversationId: z.string().describe('The conversation ID this todo belongs to'),
  /** IDs of todos this todo is blocked by (optional) */
  blockedBy: z.array(z.string()).optional().describe('IDs of todos this todo depends on'),
  /** Todo metadata (optional) */
  metadata: z.object({
    /** Priority level */
    priority: z.enum(['low', 'medium', 'high']).optional(),
    /** Tags for categorization */
    tags: z.array(z.string()).optional(),
    /** Any additional data */
  }).passthrough().optional().describe('Additional todo metadata'),
});

export type TodoCreateToolInput = z.infer<typeof todoCreateToolSchema>;

export type TodoCreateToolOutput = {
  success: true;
  todo: {
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
 * Create a TodoCreateTool
 * 
 * @param store - The todo store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTodoStore();
 * const todoCreateTool = createTodoCreateTool(store);
 * 
 * const result = await todoCreateTool.execute({
 *   subject: 'Implement user authentication',
 *   blockedBy: ['todo-1'], // depends on design todo
 *   metadata: { priority: 'high', tags: ['backend', 'security'] }
 * });
 * ```
 */

/**
 * Create a TodoCreateTool with conversation context
 * 
 * @param store - The todo store
 * @param conversationId - The conversation ID to associate todos with
 * @returns The tool definition
 */
export function createTodoCreateToolForConversation(store: TodoStore, conversationId: string) {
  return tool({
    description: `Create a new todo. Use this to create todos that can be tracked during execution.

IMPORTANT: When you delegate work to a sub-agent (like research tool), pass the returned todoId to the sub-agent as the 'todoId' parameter. The sub-agent will automatically update the todo status when completed. You do NOT need to call todo_update after the sub-agent finishes.

Example workflow:
1. Call todo_create to create a todo → returns todoId
2. Call research tool with todoId parameter
3. The research tool will automatically complete the todo when done
4. No need to call todo_update manually`,
    inputSchema: todoCreateToolSchema,
    execute: async (input: TodoCreateToolInput) => {
      try {
        cleanupOldCompletedTodos(store, conversationId);

        const todo = createTodo(store, {
          conversationId,
          subject: input.subject,
          blockedBy: input.blockedBy,
          metadata: input.metadata,
        });

        return {
          success: true as const,
          todo: {
            id: todo.id,
            subject: todo.subject,
            status: todo.status,
            blockedBy: todo.blockedBy,
            blocks: todo.blocks,
            createdAt: todo.createdAt,
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
