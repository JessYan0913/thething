import type { TodoStore, Todo } from './types';

/**
 * Delete a todo and clean up dependencies
 * 
 * @param store - The todo store
 * @param todoId - The todo ID to delete
 * @returns true if deleted, false if not found
 * 
 * @example
 * ```typescript
 * const deleted = deleteTodo(store, 'todo-1');
 * ```
 */
export function deleteTodo(store: TodoStore, todoId: string): boolean {
  return store.deleteTodo(todoId);
}

/**
 * Delete multiple todos
 * 
 * @param store - The todo store
 * @param todoIds - Array of todo IDs to delete
 * @returns Array of booleans indicating success for each todo
 */
export function deleteTodos(store: TodoStore, todoIds: string[]): boolean[] {
  return todoIds.map(id => store.deleteTodo(id));
}

/**
 * Delete a todo and all its dependent todos (cascade delete)
 * 
 * @param store - The todo store
 * @param todoId - The root todo ID to delete
 * @returns Array of deleted todo IDs
 */
export function deleteTodoWithDependents(store: TodoStore, todoId: string): string[] {
  const deletedIds: string[] = [];
  
  // Get all todos that depend on this todo (directly or indirectly)
  const collectDependents = (id: string): string[] => {
    const todo = store.getTodo(id);
    if (!todo) return [];
    
    const dependents: string[] = [];
    for (const dependentId of todo.blocks) {
      dependents.push(dependentId);
      dependents.push(...collectDependents(dependentId));
    }
    return dependents;
  };
  
  const dependentIds = collectDependents(todoId);
  
  // Delete dependents first (children before parents)
  for (const dependentId of dependentIds) {
    if (store.deleteTodo(dependentId)) {
      deletedIds.push(dependentId);
    }
  }
  
  // Delete the root todo
  if (store.deleteTodo(todoId)) {
    deletedIds.push(todoId);
  }
  
  return deletedIds;
}

/**
 * Remove a todo's dependencies without deleting it
 * 
 * @param store - The todo store
 * @param todoId - The todo ID to unblock
 * @returns The updated todo or undefined if not found
 */
export function removeTodoDependencies(
  store: TodoStore,
  todoId: string
): Todo | undefined {
  const todo = store.getTodo(todoId);
  if (!todo) return undefined;
  
  return store.updateTodo({ id: todoId, blockedBy: [] });
}
