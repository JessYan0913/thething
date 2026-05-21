import type { TodoStore, TodoCreateInput, Todo } from './types';

/**
 * Create a new todo
 * 
 * @param store - The todo store
 * @param input - Todo creation input
 * @returns The created todo
 * 
 * @example
 * ```typescript
 * const todo = createTodo(store, {
 *   subject: 'Design database schema',
 *   metadata: { priority: 'high', tags: ['backend', 'database'] }
 * });
 * ```
 */
export function createTodo(store: TodoStore, input: TodoCreateInput): Todo {
  return store.createTodo(input);
}

/**
 * Create multiple todos at once
 * 
 * @param store - The todo store
 * @param inputs - Array of todo creation inputs
 * @returns Array of created todos in the same order as inputs
 */
export function createTodos(store: TodoStore, inputs: TodoCreateInput[]): Todo[] {
  return inputs.map(input => store.createTodo(input));
}

/**
 * Create a todo with dependencies
 * This is a convenience function that creates the todo and its dependencies
 * in the correct order
 * 
 * @param store - The todo store
 * @param conversationId - The conversation ID this todo belongs to
 * @param subject - The todo subject
 * @param dependencySubjects - Subjects of todos this todo depends on (created if not exist)
 * @param metadata - Optional metadata for the main todo
 * @returns Object containing the main todo and any created dependency todos
 * 
 * @example
 * ```typescript
 * const { todo: mainTodo, dependencies } = createTodoWithDependencies(
 *   store,
 *   'conv-123',
 *   'Build frontend',
 *   ['Design database schema', 'Design API endpoints']
 * );
 * ```
 */
export function createTodoWithDependencies(
  store: TodoStore,
  conversationId: string,
  subject: string,
  dependencySubjects: string[],
  metadata?: TodoCreateInput['metadata']
): { todo: Todo; dependencies: Todo[] } {
  // Create dependencies first if they don't exist
  const existingTodos = store.getTodosByConversation(conversationId);
  const dependencies: Todo[] = [];
  const dependencyIds: string[] = [];

  for (const depSubject of dependencySubjects) {
    const existing = existingTodos.find(t => t.subject === depSubject);
    if (existing) {
      dependencies.push(existing);
      dependencyIds.push(existing.id);
    } else {
      const dep = store.createTodo({ conversationId, subject: depSubject });
      dependencies.push(dep);
      dependencyIds.push(dep.id);
    }
  }

  // Create the main todo with dependencies
  const todo = store.createTodo({
    conversationId,
    subject,
    blockedBy: dependencyIds,
    metadata,
  });

  return { todo, dependencies };
}
