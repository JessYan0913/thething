/**
 * Todo Tools
 *
 * Three tools for todo management:
 * - todo_create: Create a new todo
 * - todo_update: Update a todo's status or properties (claim, complete, fail, cancel)
 * - todo_delete: Soft-delete (cancel) a todo
 *
 * The task list is automatically injected into the agent's system prompt,
 * so agents do not need to call todo_list or todo_get to see their tasks.
 */

import type { Tool } from 'ai';
import type { TodoStore } from '../types';
import { createTodoCreateTool, createTodoCreateToolForConversation } from './todo-create-tool';
import { createTodoUpdateTool } from './todo-update-tool';
import { createTodoDeleteTool } from './todo-delete-tool';

/**
 * All todo tools
 */
export interface TodoTools {
  todo_create: ReturnType<typeof createTodoCreateTool>;
  todo_update: ReturnType<typeof createTodoUpdateTool>;
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
    todo_update: createTodoUpdateTool(store),
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
    todo_update: createTodoUpdateTool(store),
    todo_delete: createTodoDeleteTool(store),
  };
}

/**
 * Tool names as constants
 */
export const TODO_TOOL_NAMES = {
  TODO_CREATE: 'todo_create',
  TODO_UPDATE: 'todo_update',
  TODO_DELETE: 'todo_delete',
} as const;

export type TodoToolName = typeof TODO_TOOL_NAMES[keyof typeof TODO_TOOL_NAMES];

/**
 * Tool descriptions for display
 */
export const TODO_TOOL_DESCRIPTIONS: Record<TodoToolName, string> = {
  [TODO_TOOL_NAMES.TODO_CREATE]: 'Create a new todo',
  [TODO_TOOL_NAMES.TODO_UPDATE]: 'Update a todo\'s properties or status (claim, complete, fail, cancel)',
  [TODO_TOOL_NAMES.TODO_DELETE]: 'Cancel a todo (soft-delete)',
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
export { createTodoUpdateTool } from './todo-update-tool';
export { createTodoDeleteTool } from './todo-delete-tool';

// Re-export schemas
export { todoCreateToolSchema } from './todo-create-tool';
export { todoUpdateToolSchema } from './todo-update-tool';
export { todoDeleteToolSchema } from './todo-delete-tool';