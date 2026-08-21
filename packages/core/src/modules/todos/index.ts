/**
 * Todo Management System
 * 
 * A comprehensive todo management system with:
 * - Todo dependencies via doubly-linked list (blockedBy / blocks)
 * - High-water mark for unique ID generation
 * - Agent busy checking for todo claiming
 * - State machine: pending -> in_progress -> completed/failed/cancelled
 * - Event subscription for state changes
 * 
 * @example
 * ```typescript
 * import { createTodoStore, createTodo, claimTodo, completeTodo } from '@/todos';
 * 
 * // Create a store
 * const store = createTodoStore();
 * 
 * // Create todos with dependencies
 * const todoA = createTodo(store, { subject: 'Todo A' });
 * const todoB = createTodo(store, { subject: 'Todo B', blockedBy: [todoA.id] });
 * 
 * // Claim and complete todos
 * claimTodo(store, todoA.id, 'agent-1');
 * completeTodo(store, todoA.id, 'Done!');
 * 
 * // Now todoB is available
 * const available = getAvailableTodos(store);
 * ```
 */

// Types
export * from './types';

// Core store
export { InMemoryTodoStore, createTodoStore } from './store';

// High water mark
export {
  HighWaterMarkImpl,
  getGlobalHighWaterMark,
  setGlobalHighWaterMark,
  resetGlobalHighWaterMark,
  parseTodoId,
  createHighWaterMarkFromIds,
} from './high-water-mark';

// Todo operations
export { createTodo, createTodos, createTodoWithDependencies } from './todo-create';
export {
  updateTodo,
  updateTodoStatus,
  setTodoActiveForm,
  clearTodoActiveForm,
  completeTodo,
  failTodo,
  stopTodo,
  retryTodo,
} from './todo-update';
export { deleteTodo, deleteTodos, deleteTodoWithDependents, removeTodoDependencies } from './todo-delete';
export { claimTodo, unclaimTodo, forceClaimTodo, getTodoClaimant, isTodoClaimed } from './todo-claim';
export {
  getAvailableTodos,
  getAvailableTodosSorted,
  getNextAvailableTodo,
  getTodosByStatus,
  getAllPendingTodos,
  getAllInProgressTodos,
  getAllCompletedTodos,
  getAllFailedTodos,
  getTodosGroupedByStatus,
  getTodoListResult,
  findTodosBySubject,
  findTodoBySubject,
} from './todo-available';

// Tools for AI SDK
export {
  createTodoTools,
  createTodoToolsForConversation,
  getTodoTool,
  getTodoToolNames,
  TODO_TOOL_NAMES,
  TODO_TOOL_DESCRIPTIONS,
  type TodoToolName,
  type TodoTools,
} from './todo-tools';

// Individual tool creators
export {
  createTodoListTool,
  createTodoListToolForConversation,
  createTodoBatchCreateTool,
  createTodoBatchCreateToolForConversation,
} from './todo-tools';

// TodoRuntime（Todo Runtime 状态机 + 派生就绪/quiescence）+ Metadata V2 访问器
export {
  createTodoRuntime,
  TODO_TRANSITIONS,
  getExecution,
  getLifecycle,
  getVerification,
  getArchive,
  type TodoRuntime,
  type TodoRuntimeState,
  type ExecutionInfo,
  type TransitionError,
  type ExecutionMode,
  type QuiescenceReason,
  type TaskFinishState,
  type TodoExecutionMeta,
  type TodoLifecycleMeta,
  type TodoVerificationMeta,
  type TodoArchiveMeta,
} from './todo-runtime';

// 快照编号（方案 C 轻量：agent 凭稳定编号定位/合并）
export { indexActiveTodos, resolveActiveByIndex, resolveByStableIndex, resolveTodoReference, isActiveStatus, type IndexedActiveTodo } from './snapshot-index';
export { renderIndexedActiveList, renderIndexedActiveLine } from './todo-tools/todo-snapshot';
