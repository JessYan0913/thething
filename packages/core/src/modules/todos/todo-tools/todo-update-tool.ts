import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore, TodoStatus } from '../types';
import { updateTodo } from '../todo-update';
import { claimTodo } from '../todo-claim';

/**
 * TodoUpdateTool - Update a todo's properties or status
 * 
 * Supports updating:
 * - Status (to claim, complete, fail, or cancel todos)
 * - Subject
 * - Active form (current activity description)
 * - Metadata
 */
export const todoUpdateToolSchema = z.object({
  /** Todo ID to update (required) */
  id: z.string().describe('The ID of the todo to update'),
  /** New status (optional) */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).optional()
    .describe('New todo status'),
  /** New subject/title (optional) */
  subject: z.string().optional().describe('New todo subject'),
  /** Active form description (optional) - describes what the agent is currently doing */
  activeForm: z.string().nullable().optional()
    .describe('Description of current activity (null to clear)'),
  /** Agent ID claiming this todo (optional) - use to claim a todo */
  claimedBy: z.string().nullable().optional()
    .describe('Agent ID to claim the todo (use with status: in_progress)'),
  /** New blockedBy dependencies (optional) */
  blockedBy: z.array(z.string()).optional()
    .describe('New list of todo IDs this todo is blocked by'),
  /** Metadata to merge (optional) */
  metadata: z.record(z.string(), z.unknown()).optional()
    .describe('Metadata to merge with existing todo metadata'),
});

export type TodoUpdateToolInput = z.infer<typeof todoUpdateToolSchema>;

export type TodoUpdateToolOutput = {
  success: true;
  todo: {
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
  };
  message?: string;
} | {
  success: false;
  error: string;
};

/**
 * Create a TodoUpdateTool
 * 
 * @param store - The todo store
 * @returns The tool definition
 * 
 * @example
 * ```typescript
 * const store = createTodoStore();
 * const todoUpdateTool = createTodoUpdateTool(store);
 * 
 * // Update todo status
 * const result = await todoUpdateTool.execute({
 *   id: 'todo-1',
 *   status: 'completed',
 *   metadata: { result: 'Successfully implemented feature X' }
 * });
 * 
 * // Claim a todo
 * const result = await todoUpdateTool.execute({
 *   id: 'todo-1',
 *   status: 'in_progress',
 *   claimedBy: 'agent-1',
 *   activeForm: 'Implementing feature X'
 * });
 * ```
 */
export function createTodoUpdateTool(store: TodoStore) {
  return tool({
    description: 'Update a todo\'s properties. Use to change status, update metadata, or claim todos.',
    inputSchema: todoUpdateToolSchema,
    execute: async (input: TodoUpdateToolInput) => {
      try {
        // If claiming (status: in_progress with claimedBy), use claimTodo first
        if (input.status === 'in_progress' && input.claimedBy) {
          const claimResult = claimTodo(store, input.id, input.claimedBy);
          if (!claimResult.success) {
            return {
              success: false as const,
              error: claimResult.message || 'Failed to claim todo',
            };
          }

          // If there's an activeForm, update it
          if (input.activeForm !== undefined) {
            store.updateTodo({ id: input.id, activeForm: input.activeForm });
          }

          const updatedTodo = store.getTodo(input.id);
          if (!updatedTodo) {
            return {
              success: false as const,
              error: 'Todo not found after claim',
            };
          }

          return {
            success: true as const,
            todo: {
              id: updatedTodo.id,
              subject: updatedTodo.subject,
              status: updatedTodo.status,
              claimedBy: updatedTodo.claimedBy,
              activeForm: updatedTodo.activeForm,
              blockedBy: updatedTodo.blockedBy,
              blocks: updatedTodo.blocks,
              createdAt: updatedTodo.createdAt,
              updatedAt: updatedTodo.updatedAt,
              completedAt: updatedTodo.completedAt,
              metadata: updatedTodo.metadata,
            },
            message: 'Todo claimed successfully',
          };
        }

        // Otherwise, do a regular update
        const todo = updateTodo(store, {
          id: input.id,
          status: input.status,
          subject: input.subject,
          activeForm: input.activeForm,
          claimedBy: input.claimedBy,
          blockedBy: input.blockedBy,
          metadata: input.metadata,
        });

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
