/**
 * Todo Tools —— 单工具面（docs/todos-lite.md §5.5，D4 收敛）。
 *
 * 旧的四工具面（todo_write / todo_create_batch / todo_delete / todo_list / todo_merge）
 * 全部退役，收敛为**一个** `todo` 工具（action: list | add | update | delete | clear）：
 * - add     ：items[] 批量建骨架（依赖提示 dependsOnSteps），一次建齐；
 * - update  ：按 `#N` 引用任务改状态/字段（claim/complete/fail/retry 都是 status）；
 * - delete  ：按 `#N` 软取消；
 * - list    ：重读清单（默认紧凑视图；scope:'all' 全量；id:'#N' 单条详情）；
 * - clear  ：取消全部活跃任务。
 *
 * 模型面 id 一律 = `#N`（创建时物化的稳定编号，永不复用/重排，D2）。
 * lint 只提示不阻断；merge 退役（delete + 依赖 lint 提示承接）。
 */

import type { Tool } from 'ai';
import type { TodoStore } from '../types';
import { createTodoToolForConversation } from './todo-tool';
import { createTodoRuntime } from '../todo-runtime';

/**
 * 工具集面：只暴露单 `todo` 工具。
 */
export interface TodoTools {
  todo: ReturnType<typeof createTodoToolForConversation>;
}

/**
 * 创建绑定到 store 的 todo 工具集。无会话上下文时以 'default' 圈定。
 */
export function createTodoTools(store: TodoStore, conversationId = 'default'): TodoTools {
  const runtime = createTodoRuntime({ store, conversationId });
  return {
    todo: createTodoToolForConversation(store, conversationId, { scheduler: runtime }),
  };
}

/**
 * 创建绑定会话的 todo 工具集（agent/tools.ts 装配入口）。
 */
export function createTodoToolsForConversation(
  store: TodoStore,
  conversationId: string,
  opts: { scheduler: import('../todo-runtime').TodoRuntime },
): TodoTools {
  return {
    todo: createTodoToolForConversation(store, conversationId, opts),
  };
}

/**
 * 工具名常量
 */
export const TODO_TOOL_NAMES = {
  TODO: 'todo',
} as const;

export type TodoToolName = typeof TODO_TOOL_NAMES[keyof typeof TODO_TOOL_NAMES];

/**
 * 工具描述（展示用）
 */
export const TODO_TOOL_DESCRIPTIONS: Record<TodoToolName, string> = {
  [TODO_TOOL_NAMES.TODO]: 'Manage the session task list: list / add (batch) / update by #N / delete / clear',
};

/**
 * 按名字取工具
 */
export function getTodoTool(store: TodoStore, name: TodoToolName): Tool | undefined {
  const tools = createTodoTools(store);
  return (tools as unknown as Record<string, Tool>)[name];
}

/**
 * 全部工具名
 */
export function getTodoToolNames(): TodoToolName[] {
  return Object.values(TODO_TOOL_NAMES);
}

// Re-export single tool
export { createTodoToolForConversation } from './todo-tool';

// Re-export 输入修复（模型把 items 数组序列化成字符串时，供 repairToolCall 使用）
export { repairTodoRawInput } from './todo-tool';

// Re-export schema
export { todoToolSchema } from './todo-tool';
export type { TodoToolInput } from './todo-tool';