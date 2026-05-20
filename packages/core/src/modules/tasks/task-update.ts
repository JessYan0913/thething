import type { TaskStore, TaskUpdateInput, Task, TaskStatus } from './types';

/**
 * Update a task
 * 
 * @param store - The task store
 * @param input - Task update input
 * @returns The updated task or undefined if not found
 * 
 * @example
 * ```typescript
 * const task = updateTask(store, {
 *   id: 'task-1',
 *   subject: 'Updated subject'
 * });
 * ```
 */
export function updateTask(store: TaskStore, input: TaskUpdateInput): Task | undefined {
  return store.updateTask(input);
}

/**
 * Update task status
 * 
 * @param store - The task store
 * @param taskId - The task ID
 * @param status - The new status
 * @returns The updated task or undefined if not found
 */
export function updateTaskStatus(
  store: TaskStore,
  taskId: string,
  status: TaskStatus
): Task | undefined {
  return store.updateTask({ id: taskId, status });
}

/**
 * Set task active form (what the agent is currently doing)
 * 
 * @param store - The task store
 * @param taskId - The task ID
 * @param activeForm - Description of current activity
 * @returns The updated task or undefined if not found
 */
export function setTaskActiveForm(
  store: TaskStore,
  taskId: string,
  activeForm: string
): Task | undefined {
  return store.updateTask({ id: taskId, activeForm });
}

/**
 * Clear task active form
 * 
 * @param store - The task store
 * @param taskId - The task ID
 * @returns The updated task or undefined if not found
 */
export function clearTaskActiveForm(
  store: TaskStore,
  taskId: string
): Task | undefined {
  return store.updateTask({ id: taskId, activeForm: null });
}

/**
 * Complete a task with a result
 * 
 * @param store - The task store
 * @param taskId - The task ID
 * @param result - Result summary
 * @returns The updated task or undefined if not found
 * 
 * @example
 * ```typescript
 * const task = completeTask(store, 'task-1', 'Successfully implemented user authentication');
 * ```
 */
export function completeTask(
  store: TaskStore,
  taskId: string,
  result: string
): Task | undefined {
  return store.updateTask({
    id: taskId,
    status: 'completed',
    metadata: { result },
    activeForm: null,
  });
}

/**
 * Fail a task with an error message
 * 
 * @param store - The task store
 * @param taskId - The task ID
 * @param error - Error message
 * @returns The updated task or undefined if not found
 * 
 * @example
 * ```typescript
 * const task = failTask(store, 'task-1', 'Connection timeout after 30 seconds');
 * ```
 */
export function failTask(
  store: TaskStore,
  taskId: string,
  error: string
): Task | undefined {
  return store.updateTask({
    id: taskId,
    status: 'failed',
    metadata: { error },
    activeForm: null,
  });
}

/**
 * Stop a task with a reason
 * 
 * @param store - The task store
 * @param taskId - The task ID
 * @param reason - Reason for stopping
 * @returns The updated task or undefined if not found
 */
export function stopTask(
  store: TaskStore,
  taskId: string,
  reason?: string
): Task | undefined {
  return store.updateTask({
    id: taskId,
    status: 'cancelled',
    metadata: { stopReason: reason },
    activeForm: null,
  });
}

/**
 * Retry a failed or cancelled task (resets to pending)
 * 
 * @param store - The task store
 * @param taskId - The task ID
 * @returns The updated task or undefined if not found
 */
export function retryTask(store: TaskStore, taskId: string): Task | undefined {
  const task = store.getTask(taskId);
  if (!task) return undefined;
  
  if (task.status !== 'failed' && task.status !== 'cancelled') {
    throw new Error(`Cannot retry task in status ${task.status}`);
  }
  
  return store.updateTask({
    id: taskId,
    status: 'pending',
    metadata: { ...task.metadata, error: undefined, stopReason: undefined },
  });
}
