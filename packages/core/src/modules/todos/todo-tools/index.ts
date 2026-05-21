/**
 * Todo Tools
 * 
 * A collection of AI tools for todo management operations.
 * These tools are designed to be used with the Vercel AI SDK.
 */

import type { Tool } from 'ai';
import type { TodoStore } from '../types';
import { createTodoCreateTool, createTodoCreateToolForConversation } from './todo-create-tool';
import { createTodoListTool } from './todo-list-tool';
import { createTodoUpdateTool } from './todo-update-tool';
import { createTodoGetTool } from './todo-get-tool';
import { createTodoStopTool } from './todo-stop-tool';
import { createTodoDeleteTool } from './todo-delete-tool';

/**
 * All todo tools
 */
export interface TodoTools {
  todo_create: ReturnType<typeof createTodoCreateTool>;
  todo_list: ReturnType<typeof createTodoListTool>;
  todo_update: ReturnType<typeof createTodoUpdateTool>;
  todo_get: ReturnType<typeof createTodoGetTool>;
  todo_stop: ReturnType<typeof createTodoStopTool>;
  todo_delete: ReturnType<typeof createTodoDeleteTool>;
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
 * 
 * // Use with AI SDK
 * const result = await tools.todo_create.execute({
 *   subject: 'Implement feature X'
 * });
 * ```
 */
export function createTodoTools(store: TodoStore): TodoTools {
  return {
    todo_create: createTodoCreateTool(store),
    todo_list: createTodoListTool(store),
    todo_update: createTodoUpdateTool(store),
    todo_get: createTodoGetTool(store),
    todo_stop: createTodoStopTool(store),
    todo_delete: createTodoDeleteTool(store),
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
    todo_create: createTodoCreateToolForConversation(store, conversationId),
    todo_list: createTodoListTool(store),
    todo_update: createTodoUpdateTool(store),
    todo_get: createTodoGetTool(store),
    todo_stop: createTodoStopTool(store),
    todo_delete: createTodoDeleteTool(store),
  };
}

/**
 * Tool names as constants
 */
export const TODO_TOOL_NAMES = {
  TODO_CREATE: 'todo_create',
  TODO_LIST: 'todo_list',
  TODO_UPDATE: 'todo_update',
  TODO_GET: 'todo_get',
  TODO_STOP: 'todo_stop',
  TODO_DELETE: 'todo_delete',
} as const;

export type TodoToolName = typeof TODO_TOOL_NAMES[keyof typeof TODO_TOOL_NAMES];

/**
 * Tool descriptions for display
 */
export const TODO_TOOL_DESCRIPTIONS: Record<TodoToolName, string> = {
  [TODO_TOOL_NAMES.TODO_CREATE]: 'Create a new todo',
  [TODO_TOOL_NAMES.TODO_LIST]: 'List todos with optional filters',
  [TODO_TOOL_NAMES.TODO_UPDATE]: 'Update a todo\'s properties or status',
  [TODO_TOOL_NAMES.TODO_GET]: 'Get details of a specific todo',
  [TODO_TOOL_NAMES.TODO_STOP]: 'Stop a running todo',
  [TODO_TOOL_NAMES.TODO_DELETE]: 'Delete a todo',
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
export { createTodoCreateTool, createTodoCreateToolForConversation } from './todo-create-tool';
export { createTodoListTool } from './todo-list-tool';
export { createTodoUpdateTool } from './todo-update-tool';
export { createTodoGetTool } from './todo-get-tool';
export { createTodoStopTool } from './todo-stop-tool';
export { createTodoDeleteTool } from './todo-delete-tool';

// Re-export schemas
export { todoCreateToolSchema } from './todo-create-tool';
export { todoListToolSchema } from './todo-list-tool';
export { todoUpdateToolSchema } from './todo-update-tool';
export { todoGetToolSchema } from './todo-get-tool';
export { todoStopToolSchema } from './todo-stop-tool';
export { todoDeleteToolSchema } from './todo-delete-tool';
