import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore, Todo } from '../types';
import { logger } from '../../../primitives/logger';
import { renderIndexedActiveList } from './todo-snapshot';

/**
 * TodoListTool - List todos with a compact snapshot, or get a single todo's full details
 *
 * 两种模式：
 * - 不传 id → 返回紧凑清单快照（token 高效，适合看当前任务清单/进度）
 * - 传 id → 返回单条完整详情（含 metadata、时间戳、result，适合引用某任务的完整上下文）
 *
 * 合并自原 todo_list / todo_get：清单已自动注入系统提示，模型的查看需求主要剩
 * "引用某条已完成任务的 result 作为后续输入"这一低频场景，用 id 参数覆盖。
 */
export const todoListToolSchema = z.object({
  /** Optional: filter by status */
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).optional()
    .describe('Filter by status (optional). Returns all statuses if omitted.'),
  /** Optional: conversation ID (auto-set when bound to conversation) */
  conversationId: z.string().optional()
    .describe('Conversation ID to list todos for'),
  /** Optional: get full details of a single todo by ID */
  id: z.string().optional()
    .describe('Get full details of a single todo by ID (includes metadata, timestamps, result). Omit to list the task snapshot.'),
});

export type TodoListToolInput = z.infer<typeof todoListToolSchema>;

type CompactTodo = {
  id: string;
  subject: string;
  status: string;
  activeForm: string | null;
  claimedBy: string | null;
  blockedBy: string[];
  blocks: string[];
};

type FullTodo = CompactTodo & {
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  metadata: Record<string, unknown>;
};

export type TodoListToolOutput = {
  success: true;
  todos: CompactTodo[];
  total: number;
  snapshot: string;
} | {
  success: true;
  todo: FullTodo;
} | {
  success: false;
  error: string;
};

/**
 * Build a compact text snapshot of the todo list
 * 活跃任务经共享 renderIndexedActiveList 渲染（方案 C：编号 [#N]，无 id），
 * 与 todo_write 输出 / 台账保持编号一致，agent 可跨界面引用同一编号。
 */
function buildSnapshot(todos: Todo[], store: TodoStore): string {
  if (todos.length === 0) {
    return '当前没有任务。';
  }

  const lines: string[] = [];
  const completed = todos.filter(t => t.status === 'completed');
  const stats = renderStats(todos);

  if (stats) {
    lines.push(`任务清单 (${stats})`);
    lines.push('');
  }

  const active = renderIndexedActiveList(todos, store);
  if (active) {
    lines.push(active);
  }

  // Completed (last 3)
  if (completed.length > 0) {
    lines.push('');
    const recent = completed.slice(-3);
    for (const todo of recent) {
      const result = todo.metadata?.result ? `: ${todo.metadata.result}` : '';
      lines.push(`[x] ${todo.subject}${result}`);
    }
    if (completed.length > 3) {
      lines.push(`... 还有 ${completed.length - 3} 条已完成`);
    }
  }

  return lines.join('\n');
}

function renderStats(todos: Todo[]): string {
  const inProgress = todos.filter(t => t.status === 'in_progress').length;
  const pending = todos.filter(t => t.status === 'pending').length;
  const completed = todos.filter(t => t.status === 'completed').length;
  const failed = todos.filter(t => t.status === 'failed').length;
  return [
    inProgress > 0 ? `进行中: ${inProgress}` : '',
    pending > 0 ? `待办: ${pending}` : '',
    completed > 0 ? `已完成: ${completed}` : '',
    failed > 0 ? `失败: ${failed}` : '',
  ].filter(Boolean).join(' | ');
}

function toCompact(todo: Todo): CompactTodo {
  return {
    id: todo.id,
    subject: todo.subject,
    status: todo.status,
    activeForm: todo.activeForm,
    claimedBy: todo.claimedBy,
    blockedBy: todo.blockedBy,
    blocks: todo.blocks,
  };
}

function toFull(todo: Todo): FullTodo {
  return {
    ...toCompact(todo),
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    completedAt: todo.completedAt,
    metadata: todo.metadata,
  };
}

/**
 * Create a TodoListTool
 *
 * @param store - The todo store
 * @returns The tool definition
 */
export function createTodoListTool(store: TodoStore) {
  return tool({
    description: 'Inspect todos. Without id: list all todos with a compact snapshot (status, dependencies, active work) to see the current task list and progress. With id: get the full details of a specific todo (metadata, timestamps, result) — e.g. to reference the result of a completed task as input for subsequent steps.',
    inputSchema: todoListToolSchema,
    execute: async (input: TodoListToolInput) => {
      try {
        // 单条详情模式
        if (input.id) {
          const todo = store.getTodo(input.id);
          if (!todo) {
            return {
              success: false as const,
              error: `Todo ${input.id} not found`,
            };
          }
          // 读回可观测：索引池短钩子→完整详情读回计数（Phase 5 统计 todo_list({id}) 查询率用）
          logger.info('TodoList', `[read_back] ${input.id}`);
          return {
            success: true as const,
            todo: toFull(todo),
          };
        }

        const convId = input.conversationId || 'default';
        let todos = store.getTodosByConversation(convId);

        if (input.status) {
          todos = todos.filter(t => t.status === input.status);
        }

        const compact = todos.map(toCompact);
        const snapshot = buildSnapshot(todos, store);

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
    description: 'Inspect todos. Without id: list all todos with a compact snapshot (status, dependencies, active work) to see the current task list and progress. With id: get the full details of a specific todo (metadata, timestamps, result) — e.g. to reference the result of a completed task as input for subsequent steps.',
    inputSchema: todoListToolSchema.omit({ conversationId: true }),
    execute: async (input: Omit<TodoListToolInput, 'conversationId'>) => {
      try {
        // 单条详情模式
        if (input.id) {
          const todo = store.getTodo(input.id);
          if (!todo) {
            return {
              success: false as const,
              error: `Todo ${input.id} not found`,
            };
          }
          // 读回可观测：索引池短钩子→完整详情读回计数（Phase 5 统计 todo_list({id}) 查询率用）
          logger.info('TodoList', `[read_back] ${input.id}`);
          return {
            success: true as const,
            todo: toFull(todo),
          };
        }

        let todos = store.getTodosByConversation(conversationId);

        if (input.status) {
          todos = todos.filter(t => t.status === input.status);
        }

        const compact = todos.map(toCompact);
        const snapshot = buildSnapshot(todos, store);

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
