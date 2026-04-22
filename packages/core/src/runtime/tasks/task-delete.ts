import type { TaskStore, Task } from './types';

/**
 * Delete a task and clean up dependencies
 * 
 * @param store - The task store
 * @param taskId - The task ID to delete
 * @returns true if deleted, false if not found
 * 
 * @example
 * ```typescript
 * const deleted = deleteTask(store, 'task-1');
 * ```
 */
export function deleteTask(store: TaskStore, taskId: string): boolean {
  return store.deleteTask(taskId);
}

/**
 * Delete multiple tasks
 * 
 * @param store - The task store
 * @param taskIds - Array of task IDs to delete
 * @returns Array of booleans indicating success for each task
 */
export function deleteTasks(store: TaskStore, taskIds: string[]): boolean[] {
  return taskIds.map(id => store.deleteTask(id));
}

/**
 * Delete a task and all its dependent tasks (cascade delete)
 * 
 * @param store - The task store
 * @param taskId - The root task ID to delete
 * @returns Array of deleted task IDs
 */
export function deleteTaskWithDependents(store: TaskStore, taskId: string): string[] {
  const deletedIds: string[] = [];
  
  // Get all tasks that depend on this task (directly or indirectly)
  const collectDependents = (id: string): string[] => {
    const task = store.getTask(id);
    if (!task) return [];
    
    const dependents: string[] = [];
    for (const dependentId of task.blocks) {
      dependents.push(dependentId);
      dependents.push(...collectDependents(dependentId));
    }
    return dependents;
  };
  
  const dependentIds = collectDependents(taskId);
  
  // Delete dependents first (children before parents)
  for (const dependentId of dependentIds) {
    if (store.deleteTask(dependentId)) {
      deletedIds.push(dependentId);
    }
  }
  
  // Delete the root task
  if (store.deleteTask(taskId)) {
    deletedIds.push(taskId);
  }
  
  return deletedIds;
}

/**
 * Remove a task's dependencies without deleting it
 * 
 * @param store - The task store
 * @param taskId - The task ID to unblock
 * @returns The updated task or undefined if not found
 */
export function removeTaskDependencies(
  store: TaskStore,
  taskId: string
): Task | undefined {
  const task = store.getTask(taskId);
  if (!task) return undefined;
  
  return store.updateTask({ id: taskId, blockedBy: [] });
}
