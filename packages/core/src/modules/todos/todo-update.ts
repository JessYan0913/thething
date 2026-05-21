import type { TodoStore, TodoUpdateInput, Todo, TodoStatus } from './types';

/**
 * Update a todo
 * 
 * @param store - The todo store
 * @param input - Todo update input
 * @returns The updated todo or undefined if not found
 * 
 * @example
 * ```typescript
 * const todo = updateTodo(store, {
 *   id: 'todo-1',
 *   subject: 'Updated subject'
 * });
 * ```
 */
export function updateTodo(store: TodoStore, input: TodoUpdateInput): Todo | undefined {
  return store.updateTodo(input);
}

/**
 * Update todo status
 * 
 * @param store - The todo store
 * @param todoId - The todo ID
 * @param status - The new status
 * @returns The updated todo or undefined if not found
 */
export function updateTodoStatus(
  store: TodoStore,
  todoId: string,
  status: TodoStatus
): Todo | undefined {
  return store.updateTodo({ id: todoId, status });
}

/**
 * Set todo active form (what the agent is currently doing)
 * 
 * @param store - The todo store
 * @param todoId - The todo ID
 * @param activeForm - Description of current activity
 * @returns The updated todo or undefined if not found
 */
export function setTodoActiveForm(
  store: TodoStore,
  todoId: string,
  activeForm: string
): Todo | undefined {
  return store.updateTodo({ id: todoId, activeForm });
}

/**
 * Clear todo active form
 * 
 * @param store - The todo store
 * @param todoId - The todo ID
 * @returns The updated todo or undefined if not found
 */
export function clearTodoActiveForm(
  store: TodoStore,
  todoId: string
): Todo | undefined {
  return store.updateTodo({ id: todoId, activeForm: null });
}

/**
 * Complete a todo with a result
 * 
 * @param store - The todo store
 * @param todoId - The todo ID
 * @param result - Result summary
 * @returns The updated todo or undefined if not found
 * 
 * @example
 * ```typescript
 * const todo = completeTodo(store, 'todo-1', 'Successfully implemented user authentication');
 * ```
 */
export function completeTodo(
  store: TodoStore,
  todoId: string,
  result: string
): Todo | undefined {
  return store.updateTodo({
    id: todoId,
    status: 'completed',
    metadata: { result },
    activeForm: null,
  });
}

/**
 * Fail a todo with an error message
 * 
 * @param store - The todo store
 * @param todoId - The todo ID
 * @param error - Error message
 * @returns The updated todo or undefined if not found
 * 
 * @example
 * ```typescript
 * const todo = failTodo(store, 'todo-1', 'Connection timeout after 30 seconds');
 * ```
 */
export function failTodo(
  store: TodoStore,
  todoId: string,
  error: string
): Todo | undefined {
  return store.updateTodo({
    id: todoId,
    status: 'failed',
    metadata: { error },
    activeForm: null,
  });
}

/**
 * Stop a todo with a reason
 * 
 * @param store - The todo store
 * @param todoId - The todo ID
 * @param reason - Reason for stopping
 * @returns The updated todo or undefined if not found
 */
export function stopTodo(
  store: TodoStore,
  todoId: string,
  reason?: string
): Todo | undefined {
  return store.updateTodo({
    id: todoId,
    status: 'cancelled',
    metadata: { stopReason: reason },
    activeForm: null,
  });
}

/**
 * Retry a failed or cancelled todo (resets to pending)
 * 
 * @param store - The todo store
 * @param todoId - The todo ID
 * @returns The updated todo or undefined if not found
 */
export function retryTodo(store: TodoStore, todoId: string): Todo | undefined {
  const todo = store.getTodo(todoId);
  if (!todo) return undefined;
  
  if (todo.status !== 'failed' && todo.status !== 'cancelled') {
    throw new Error(`Cannot retry todo in status ${todo.status}`);
  }
  
  return store.updateTodo({
    id: todoId,
    status: 'pending',
    metadata: { ...todo.metadata, error: undefined, stopReason: undefined },
  });
}
