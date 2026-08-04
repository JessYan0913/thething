import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore, Todo } from '../types';

/**
 * TodoListTool - List todos with compact snapshot
 *
 * Returns a compact snapshot of all todos, intelligently filtered to
 * show the most relevant information while saving context.
 *
 * The snapshot format is designed to be token-efficient:
 * - No metadata, no timestamps, no full descriptions
 * - Only id, subject, status, activeForm, blockedBy
 */
export const todoListToolSchema = z.object({
  /** Optional: filter by status */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).optional()
    .describe('Filter by status (optional). Returns all statuses if omitted.'),
  /** Optional: conversation ID (auto-set when bound to conversation) */
  conversationId: z.string().optional()
    .describe('Conversation ID to list todos for'),
});

export type TodoListToolInput = z.infer<typeof todoListToolSchema>;

export type TodoListToolOutput = {
  success: true;
  todos: Array<{
    id: string;
    subject: string;
    status: string;
    activeForm: string | null;
    claimedBy: string | null;
    blockedBy: string[];
    blocks: string[];
  }>;
  total: number;
  snapshot: string;
} | {
  success: false;
  error: string;
};

/**
 * Build a compact text snapshot of the todo list
 */
function buildSnapshot(todos: Array<{
  id: string;
  subject: string;
  status: string;
  activeForm: string | null;
  claimedBy: string | null;
  blockedBy: string[];
}>, store: TodoStore): string {
  if (todos.length === 0) {
    return '当前没有任务。';
  }

  const lines: string[] = [];
  const inProgress = todos.filter(t => t.status === 'in_progress');
  const pending = todos.filter(t => t.status === 'pending');
  const completed = todos.filter(t => t.status === 'completed');

  // Stats line
  const stats = [
    inProgress.length > 0 ? `进行中: ${inProgress.length}` : '',
    pending.length > 0 ? `待办: ${pending.length}` : '',
    completed.length > 0 ? `已完成: ${completed.length}` : '',
  ].filter(Boolean).join(' | ');

  if (stats) {
    lines.push(`任务清单 (${stats})`);
    lines.push('');
  }

  // In progress
  for (const todo of inProgress) {
    const active = todo.activeForm ? ` — ${todo.activeForm}` : '';
    const owner = todo.claimedBy ? ` (${todo.claimedBy})` : '';
    lines.push(`[→] #${todo.id} ${todo.subject}${active}${owner}`);
  }

  // Pending (unblocked first)
  const unblocked = pending.filter(t => t.blockedBy.length === 0);
  const blocked = pending.filter(t => t.blockedBy.length > 0);

  for (const todo of unblocked) {
    lines.push(`[ ] #${todo.id} ${todo.subject}`);
  }
  for (const todo of blocked) {
    const depNames = todo.blockedBy.map(id => {
      const dep = store.getTodo(id);
      return dep ? `#${dep.id} ${dep.subject}` : `#${id} (已删除)`;
    });
    lines.push(`[ ] #${todo.id} ${todo.subject} (被 ${depNames.join(', ')} 阻塞)`);
  }

  // Completed (last 3)
  if (completed.length > 0) {
    lines.push('');
    const recent = completed.slice(-3);
    for (const todo of recent) {
      lines.push(`[x] #${todo.id} ${todo.subject}`);
    }
    if (completed.length > 3) {
      lines.push(`... 还有 ${completed.length - 3} 条已完成`);
    }
  }

  return lines.join('\n');
}

/**
 * Create a TodoListTool
 *
 * @param store - The todo store
 * @returns The tool definition
 */
export function createTodoListTool(store: TodoStore) {
  return tool({
    description: 'List all todos with a compact snapshot. Use this to see the current task list, check progress, and understand what needs to be done next. The snapshot shows status, dependencies, and active work.',
    inputSchema: todoListToolSchema,
    execute: async (input: TodoListToolInput) => {
      try {
        const convId = input.conversationId || 'default';
        let todos = store.getTodosByConversation(convId);

        if (input.status) {
          todos = todos.filter(t => t.status === input.status);
        }

        const compact = todos.map(t => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          activeForm: t.activeForm,
          claimedBy: t.claimedBy,
          blockedBy: t.blockedBy,
          blocks: t.blocks,
        }));

        const snapshot = buildSnapshot(compact, store);

        return {
          success: true as const,
          todos: compact,
          total: compact.length,
          snapshot,
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
 * Create a TodoListTool bound to a conversation
 *
 * @param store - The todo store
 * @param conversationId - The conversation ID to filter by
 * @returns The tool definition
 */
export function createTodoListToolForConversation(store: TodoStore, conversationId: string) {
  return tool({
    description: 'List all todos with a compact snapshot. Use this to see the current task list, check progress, and understand what needs to be done next. The snapshot shows status, dependencies, and active work.',
    inputSchema: todoListToolSchema.omit({ conversationId: true }),
    execute: async (input: Omit<TodoListToolInput, 'conversationId'>) => {
      try {
        let todos = store.getTodosByConversation(conversationId);

        if (input.status) {
          todos = todos.filter(t => t.status === input.status);
        }

        const compact = todos.map(t => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          activeForm: t.activeForm,
          claimedBy: t.claimedBy,
          blockedBy: t.blockedBy,
          blocks: t.blocks,
        }));

        const snapshot = buildSnapshot(compact, store);

        return {
          success: true as const,
          todos: compact,
          total: compact.length,
          snapshot,
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