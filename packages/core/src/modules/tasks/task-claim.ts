import type { TaskStore, TaskClaimResult, Task } from './types';

/**
 * Claim a task for an agent
 * 
 * This will fail if:
 * - The task doesn't exist
 * - The task is not pending
 * - The task has incomplete dependencies
 * - The task is already claimed by another agent
 * - The agent is already busy with another task
 * 
 * @param store - The task store
 * @param taskId - The task ID to claim
 * @param agentId - The agent ID claiming the task
 * @returns The claim result
 * 
 * @example
 * ```typescript
 * const result = claimTask(store, 'task-1', 'agent-1');
 * if (result.success) {
 *   console.log('Claimed task:', result.task);
 * } else {
 *   console.log('Claim failed:', result.message);
 * }
 * ```
 */
export function claimTask(store: TaskStore, taskId: string, agentId: string): TaskClaimResult {
  return store.claimTask(taskId, agentId);
}

/**
 * Unclaim a task (release it back to pending)
 * 
 * @param store - The task store
 * @param taskId - The task ID to unclaim
 * @returns The updated task or undefined if not found
 */
export function unclaimTask(store: TaskStore, taskId: string): Task | undefined {
  const task = store.getTask(taskId);
  if (!task) return undefined;
  
  if (task.status !== 'in_progress') {
    throw new Error(`Cannot unclaim task in status ${task.status}`);
  }
  
  return store.updateTask({
    id: taskId,
    status: 'pending',
    claimedBy: null,
  });
}

/**
 * Force claim a task (overrides busy check)
 * 
 * Use with caution - this will make any agent currently holding the task
 * appear as if they're no longer busy with it.
 * 
 * @param store - The task store
 * @param taskId - The task ID to claim
 * @param agentId - The agent ID claiming the task
 * @returns The claim result
 */
export function forceClaimTask(
  store: TaskStore,
  taskId: string,
  agentId: string
): TaskClaimResult {
  const task = store.getTask(taskId);
  
  if (!task) {
    return { success: false, message: `Task ${taskId} not found` };
  }
  
  if (task.status !== 'pending' && task.status !== 'in_progress') {
    return {
      success: false,
      message: `Task ${taskId} is not claimable (current status: ${task.status})`,
    };
  }
  
  // If the task was claimed by another agent, free them
  if (task.claimedBy && task.claimedBy !== agentId) {
    store.setAgentBusy(task.claimedBy, false, taskId);
  }
  
  // Claim the task
  return store.claimTask(taskId, agentId);
}

/**
 * Get the agent currently working on a task
 * 
 * @param store - The task store
 * @param taskId - The task ID
 * @returns The agent ID or null if not claimed
 */
export function getTaskClaimant(store: TaskStore, taskId: string): string | null {
  const task = store.getTask(taskId);
  return task?.claimedBy || null;
}

/**
 * Check if a task is claimed
 * 
 * @param store - The task store
 * @param taskId - The task ID
 * @returns true if claimed, false otherwise
 */
export function isTaskClaimed(store: TaskStore, taskId: string): boolean {
  const task = store.getTask(taskId);
  return task?.claimedBy !== null && task?.claimedBy !== undefined;
}
