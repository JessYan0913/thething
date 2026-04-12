import type { TaskStore, TaskCreateInput, Task } from './types';

/**
 * Create a new task
 * 
 * @param store - The task store
 * @param input - Task creation input
 * @returns The created task
 * 
 * @example
 * ```typescript
 * const task = createTask(store, {
 *   subject: 'Design database schema',
 *   metadata: { priority: 'high', tags: ['backend', 'database'] }
 * });
 * ```
 */
export function createTask(store: TaskStore, input: TaskCreateInput): Task {
  return store.createTask(input);
}

/**
 * Create multiple tasks at once
 * 
 * @param store - The task store
 * @param inputs - Array of task creation inputs
 * @returns Array of created tasks in the same order as inputs
 */
export function createTasks(store: TaskStore, inputs: TaskCreateInput[]): Task[] {
  return inputs.map(input => store.createTask(input));
}

/**
 * Create a task with dependencies
 * This is a convenience function that creates the task and its dependencies
 * in the correct order
 * 
 * @param store - The task store
 * @param subject - The task subject
 * @param dependencySubjects - Subjects of tasks this task depends on (created if not exist)
 * @param metadata - Optional metadata for the main task
 * @returns Object containing the main task and any created dependency tasks
 * 
 * @example
 * ```typescript
 * const { task: mainTask, dependencies } = createTaskWithDependencies(
 *   store,
 *   'Build frontend',
 *   ['Design database schema', 'Design API endpoints']
 * );
 * ```
 */
export function createTaskWithDependencies(
  store: TaskStore,
  subject: string,
  dependencySubjects: string[],
  metadata?: TaskCreateInput['metadata']
): { task: Task; dependencies: Task[] } {
  // Create dependencies first if they don't exist
  const existingTasks = store.getAllTasks();
  const dependencies: Task[] = [];
  const dependencyIds: string[] = [];

  for (const depSubject of dependencySubjects) {
    const existing = existingTasks.find(t => t.subject === depSubject);
    if (existing) {
      dependencies.push(existing);
      dependencyIds.push(existing.id);
    } else {
      const dep = store.createTask({ subject: depSubject });
      dependencies.push(dep);
      dependencyIds.push(dep.id);
    }
  }

  // Create the main task with dependencies
  const task = store.createTask({
    subject,
    blockedBy: dependencyIds,
    metadata,
  });

  return { task, dependencies };
}
