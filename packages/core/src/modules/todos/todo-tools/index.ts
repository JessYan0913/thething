/**
 * Todo Tools
 *
 * Tools for todo management:
 * - todo_write: Full-list replace (preferred entry point for planning/progress)
 * - todo_create_batch: Create multiple todos with dependency declarations (blockedBy)
 * - todo_delete: Soft-delete (cancel) a todo
 * - todo_list: Inspect the task list (snapshot), or get a single todo's full details (id)
 *
 * The task list is automatically injected into the agent's system prompt,
 * so agents do not need to call todo_list to see their tasks.
 */

import type { Tool } from 'ai';
import type { TodoStore } from '../types';
import { createTodoDeleteTool } from './todo-delete-tool';
import { createTodoListTool, createTodoListToolForConversation } from './todo-list-tool';
import { createTodoBatchCreateTool, createTodoBatchCreateToolForConversation } from './todo-batch-create-tool';
import { createTodoWriteToolForConversation } from './todo-write-tool';

/**
 * All todo tools
 */
export interface TodoTools {
  todo_delete: ReturnType<typeof createTodoDeleteTool>;
  todo_list: ReturnType<typeof createTodoListTool>;
  todo_create_batch: ReturnType<typeof createTodoBatchCreateTool>;
  /** 仅会话绑定变体提供（整表替换需要 conversationId 圈定范围） */
  todo_write?: ReturnType<typeof createTodoWriteToolForConversation>;
}

/**
 * Create all todo tools bound to a store
 *
 * @param store - The todo store
 * @returns Object containing all todo tools
 *
 * @example
 * ```typescript
 * import { createTodoTools } from '@/todos/tools';
 *
 * const store = createTodoStore();
 * const tools = createTodoTools(store);
 * ```
 */
export function createTodoTools(store: TodoStore): TodoTools {
  return {
    todo_delete: createTodoDeleteTool(store),
    todo_list: createTodoListTool(store),
    todo_create_batch: createTodoBatchCreateTool(store),
  };
}

/**
 * Create todo tools with conversation context injected
 *
 * This is useful when todo tools are used within a specific conversation,
 * ensuring todos are automatically associated with that conversation.
 *
 * @param store - The todo store
 * @param conversationId - The conversation ID to associate todos with
 * @returns Object containing all todo tools
 */
export function createTodoToolsForConversation(store: TodoStore, conversationId: string): TodoTools {
  return {
    todo_write: createTodoWriteToolForConversation(store, conversationId),
    todo_delete: createTodoDeleteTool(store),
    todo_list: createTodoListToolForConversation(store, conversationId),
    todo_create_batch: createTodoBatchCreateToolForConversation(store, conversationId),
  };
}

/**
 * Tool names as constants
 */
export const TODO_TOOL_NAMES = {
  TODO_WRITE: 'todo_write',
  TODO_DELETE: 'todo_delete',
  TODO_LIST: 'todo_list',
  TODO_CREATE_BATCH: 'todo_create_batch',
} as const;

export type TodoToolName = typeof TODO_TOOL_NAMES[keyof typeof TODO_TOOL_NAMES];

/**
 * Tool descriptions for display
 */
export const TODO_TOOL_DESCRIPTIONS: Record<TodoToolName, string> = {
  [TODO_TOOL_NAMES.TODO_WRITE]: 'Create and update the full task list (full-list replace)',
  [TODO_TOOL_NAMES.TODO_DELETE]: 'Cancel a todo (soft-delete)',
  [TODO_TOOL_NAMES.TODO_LIST]: 'List todos (compact snapshot) or get a single todo\'s full details',
  [TODO_TOOL_NAMES.TODO_CREATE_BATCH]: 'Create multiple todos at once with dependency declarations',
};

/**
 * Get a single tool by name
 *
 * @param store - The todo store
 * @param name - The tool name
 * @returns The tool or undefined if not found
 */
export function getTodoTool(store: TodoStore, name: TodoToolName): Tool | undefined {
  const tools = createTodoTools(store);
  return tools[name] as Tool | undefined;
}

/**
 * Get all tool names
 */
export function getTodoToolNames(): TodoToolName[] {
  return Object.values(TODO_TOOL_NAMES);
}

// Re-export individual tools
export { createTodoDeleteTool } from './todo-delete-tool';
export { createTodoListTool, createTodoListToolForConversation } from './todo-list-tool';
export { createTodoBatchCreateTool, createTodoBatchCreateToolForConversation } from './todo-batch-create-tool';
export { createTodoWriteToolForConversation } from './todo-write-tool';

// Re-export schemas
export { todoDeleteToolSchema } from './todo-delete-tool';
export { todoListToolSchema } from './todo-list-tool';
export { todoBatchCreateToolSchema } from './todo-batch-create-tool';
export { todoWriteToolSchema } from './todo-write-tool';
