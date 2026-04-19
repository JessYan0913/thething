/**
 * Task Management System
 * 
 * A comprehensive task management system with:
 * - Task dependencies via doubly-linked list (blockedBy / blocks)
 * - High-water mark for unique ID generation
 * - Agent busy checking for task claiming
 * - State machine: pending -> in_progress -> completed/failed/cancelled
 * - Event subscription for state changes
 * 
 * @example
 * ```typescript
 * import { createTaskStore, createTask, claimTask, completeTask } from '@/tasks';
 * 
 * // Create a store
 * const store = createTaskStore();
 * 
 * // Create tasks with dependencies
 * const taskA = createTask(store, { subject: 'Task A' });
 * const taskB = createTask(store, { subject: 'Task B', blockedBy: [taskA.id] });
 * 
 * // Claim and complete tasks
 * claimTask(store, taskA.id, 'agent-1');
 * completeTask(store, taskA.id, 'Done!');
 * 
 * // Now taskB is available
 * const available = getAvailableTasks(store);
 * ```
 */

// Types
export * from './types';

// Core store
export { InMemoryTaskStore, createTaskStore, getGlobalTaskStore, setGlobalTaskStore } from './store';

// High water mark
export {
  HighWaterMarkImpl,
  getGlobalHighWaterMark,
  setGlobalHighWaterMark,
  resetGlobalHighWaterMark,
  parseTaskId,
  createHighWaterMarkFromIds,
} from './high-water-mark';

// Task operations
export { createTask, createTasks, createTaskWithDependencies } from './task-create';
export {
  updateTask,
  updateTaskStatus,
  setTaskActiveForm,
  clearTaskActiveForm,
  completeTask,
  failTask,
  stopTask,
  retryTask,
} from './task-update';
export { deleteTask, deleteTasks, deleteTaskWithDependents, removeTaskDependencies } from './task-delete';
export { claimTask, unclaimTask, forceClaimTask, getTaskClaimant, isTaskClaimed } from './task-claim';
export {
  getAvailableTasks,
  getAvailableTasksSorted,
  getNextAvailableTask,
  getTasksByStatus,
  getAllPendingTasks,
  getAllInProgressTasks,
  getAllCompletedTasks,
  getAllFailedTasks,
  getTasksGroupedByStatus,
  getTaskListResult,
  findTasksBySubject,
  findTaskBySubject,
} from './task-available';
