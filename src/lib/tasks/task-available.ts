import type { TaskStore, Task, TaskStatus, TaskListResult } from './types';

/**
 * Get all available tasks for an agent to claim
 * 
 * A task is available if:
 * - Status is 'pending'
 * - Not claimed by any agent
 * - All blockedBy dependencies are 'completed'
 * 
 * @param store - The task store
 * @returns Array of available tasks
 * 
 * @example
 * ```typescript
 * const available = getAvailableTasks(store);
 * ```
 */
export function getAvailableTasks(store: TaskStore): Task[] {
  return store.getAvailableTasks();
}

/**
 * Get available tasks sorted by priority
 * 
 * @param store - The task store
 * @returns Array of available tasks sorted by priority (high first)
 */
export function getAvailableTasksSorted(store: TaskStore): Task[] {
  const tasks = store.getAvailableTasks();
  
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  
  return tasks.sort((a, b) => {
    const aPriority = priorityOrder[a.metadata?.priority || 'medium'];
    const bPriority = priorityOrder[b.metadata?.priority || 'medium'];
    
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    
    // Secondary sort by creation time (older first)
    return a.createdAt - b.createdAt;
  });
}

/**
 * Get next available task for an agent
 * 
 * Returns the highest priority available task.
 * 
 * @param store - The task store
 * @returns The next task to work on or undefined if none available
 */
export function getNextAvailableTask(store: TaskStore): Task | undefined {
  const sorted = getAvailableTasksSorted(store);
  return sorted[0];
}

/**
 * Get tasks by status
 * 
 * @param store - The task store
 * @param status - The status to filter by
 * @returns Array of tasks with the given status
 */
export function getTasksByStatus(store: TaskStore, status: TaskStatus): Task[] {
  return store.getTasksByStatus(status);
}

/**
 * Get all pending tasks (including blocked ones)
 * 
 * @param store - The task store
 * @returns Array of all pending tasks
 */
export function getAllPendingTasks(store: TaskStore): Task[] {
  return store.getTasksByStatus('pending');
}

/**
 * Get all in-progress tasks
 * 
 * @param store - The task store
 * @returns Array of all in-progress tasks
 */
export function getAllInProgressTasks(store: TaskStore): Task[] {
  return store.getTasksByStatus('in_progress');
}

/**
 * Get all completed tasks
 * 
 * @param store - The task store
 * @returns Array of all completed tasks
 */
export function getAllCompletedTasks(store: TaskStore): Task[] {
  return store.getTasksByStatus('completed');
}

/**
 * Get all failed tasks
 * 
 * @param store - The task store
 * @returns Array of all failed tasks
 */
export function getAllFailedTasks(store: TaskStore): Task[] {
  return store.getTasksByStatus('failed');
}

/**
 * Get tasks grouped by status
 * 
 * @param store - The task store
 * @returns Object with status as key and array of tasks as value
 */
export function getTasksGroupedByStatus(store: TaskStore): Record<TaskStatus, Task[]> {
  const tasks = store.getAllTasks();
  
  const result: Record<TaskStatus, Task[]> = {
    pending: [],
    in_progress: [],
    completed: [],
    failed: [],
    cancelled: [],
  };
  
  for (const task of tasks) {
    result[task.status].push(task);
  }
  
  return result;
}

/**
 * Get task list result with statistics
 * 
 * @param store - The task store
 * @param options - Optional filters
 * @returns Task list result with tasks and counts
 */
export function getTaskListResult(
  store: TaskStore,
  options?: {
    status?: TaskStatus;
    available?: boolean;
    agentId?: string;
  }
): TaskListResult {
  let tasks: Task[];
  
  if (options?.available) {
    tasks = getAvailableTasks(store);
  } else if (options?.status) {
    tasks = store.getTasksByStatus(options.status);
  } else if (options?.agentId) {
    tasks = store.getTasksByAgent(options.agentId);
  } else {
    tasks = store.getAllTasks();
  }
  
  return {
    tasks,
    total: tasks.length,
  };
}

/**
 * Find a task by subject (partial match)
 * 
 * @param store - The task store
 * @param searchTerm - The search term
 * @returns Array of matching tasks
 */
export function findTasksBySubject(store: TaskStore, searchTerm: string): Task[] {
  const lowerSearch = searchTerm.toLowerCase();
  return store.getAllTasks().filter(task =>
    task.subject.toLowerCase().includes(lowerSearch)
  );
}

/**
 * Find a task by exact subject
 * 
 * @param store - The task store
 * @param subject - The exact subject to match
 * @returns The matching task or undefined
 */
export function findTaskBySubject(store: TaskStore, subject: string): Task | undefined {
  return store.getAllTasks().find(task => task.subject === subject);
}
