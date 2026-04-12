/**
 * Task Tools
 * 
 * A collection of AI tools for task management operations.
 * These tools are designed to be used with the Vercel AI SDK.
 */

import type { Tool } from 'ai';
import type { TaskStore } from '../types';
import { createTaskCreateTool } from './task-create-tool';
import { createTaskListTool } from './task-list-tool';
import { createTaskUpdateTool } from './task-update-tool';
import { createTaskGetTool } from './task-get-tool';
import { createTaskStopTool } from './task-stop-tool';
import { createTaskDeleteTool } from './task-delete-tool';

/**
 * All task tools
 */
export interface TaskTools {
  task_create: ReturnType<typeof createTaskCreateTool>;
  task_list: ReturnType<typeof createTaskListTool>;
  task_update: ReturnType<typeof createTaskUpdateTool>;
  task_get: ReturnType<typeof createTaskGetTool>;
  task_stop: ReturnType<typeof createTaskStopTool>;
  task_delete: ReturnType<typeof createTaskDeleteTool>;
}

/**
 * Create all task tools bound to a store
 * 
 * @param store - The task store
 * @returns Object containing all task tools
 * 
 * @example
 * ```typescript
 * import { createTaskTools } from '@/lib/tasks/tools';
 * 
 * const store = createTaskStore();
 * const tools = createTaskTools(store);
 * 
 * // Use with AI SDK
 * const result = await tools.task_create.execute({
 *   subject: 'Implement feature X'
 * });
 * ```
 */
export function createTaskTools(store: TaskStore): TaskTools {
  return {
    task_create: createTaskCreateTool(store),
    task_list: createTaskListTool(store),
    task_update: createTaskUpdateTool(store),
    task_get: createTaskGetTool(store),
    task_stop: createTaskStopTool(store),
    task_delete: createTaskDeleteTool(store),
  };
}

/**
 * Tool names as constants
 */
export const TASK_TOOL_NAMES = {
  TASK_CREATE: 'task_create',
  TASK_LIST: 'task_list',
  TASK_UPDATE: 'task_update',
  TASK_GET: 'task_get',
  TASK_STOP: 'task_stop',
  TASK_DELETE: 'task_delete',
} as const;

export type TaskToolName = typeof TASK_TOOL_NAMES[keyof typeof TASK_TOOL_NAMES];

/**
 * Tool descriptions for display
 */
export const TASK_TOOL_DESCRIPTIONS: Record<TaskToolName, string> = {
  [TASK_TOOL_NAMES.TASK_CREATE]: 'Create a new task',
  [TASK_TOOL_NAMES.TASK_LIST]: 'List tasks with optional filters',
  [TASK_TOOL_NAMES.TASK_UPDATE]: 'Update a task\'s properties or status',
  [TASK_TOOL_NAMES.TASK_GET]: 'Get details of a specific task',
  [TASK_TOOL_NAMES.TASK_STOP]: 'Stop a running task',
  [TASK_TOOL_NAMES.TASK_DELETE]: 'Delete a task',
};

/**
 * Get a single tool by name
 * 
 * @param store - The task store
 * @param name - The tool name
 * @returns The tool or undefined if not found
 */
export function getTaskTool(store: TaskStore, name: TaskToolName): Tool | undefined {
  const tools = createTaskTools(store);
  return tools[name] as Tool | undefined;
}

/**
 * Get all tool names
 */
export function getTaskToolNames(): TaskToolName[] {
  return Object.values(TASK_TOOL_NAMES);
}

// Re-export individual tools
export { createTaskCreateTool } from './task-create-tool';
export { createTaskListTool } from './task-list-tool';
export { createTaskUpdateTool } from './task-update-tool';
export { createTaskGetTool } from './task-get-tool';
export { createTaskStopTool } from './task-stop-tool';
export { createTaskDeleteTool } from './task-delete-tool';

// Re-export schemas
export { taskCreateToolSchema } from './task-create-tool';
export { taskListToolSchema } from './task-list-tool';
export { taskUpdateToolSchema } from './task-update-tool';
export { taskGetToolSchema } from './task-get-tool';
export { taskStopToolSchema } from './task-stop-tool';
export { taskDeleteToolSchema } from './task-delete-tool';
