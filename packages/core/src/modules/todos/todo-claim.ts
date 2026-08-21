import type { TodoStore, TodoClaimResult, Todo } from './types';

/**
 * Claim a todo for an agent
 *
 * 账本语义（docs/todos-lite.md §3.4）：claim = 标注 in_progress + 记录执行者（展示），
 * 不做任何 gate——不查 pending、不判依赖、不管 busy、不拒重复认领。
 * 仅当 todo 不存在时失败。
 *
 * @param store - The todo store
 * @param todoId - The todo ID to claim
 * @param agentId - The agent ID claiming the todo
 * @returns The claim result
 *
 * @example
 * ```typescript
 * const result = claimTodo(store, 'todo-1', 'agent-1');
 * if (result.success) {
 *   console.log('Claimed todo:', result.todo);
 * } else {
 *   console.log('Claim failed:', result.message);
 * }
 * ```
 */
export function claimTodo(store: TodoStore, todoId: string, agentId: string): TodoClaimResult {
  return store.claimTodo(todoId, agentId);
}

/**
 * Unclaim a todo (release it back to pending)
 * 
 * @param store - The todo store
 * @param todoId - The todo ID to unclaim
 * @returns The updated todo or undefined if not found
 */
export function unclaimTodo(store: TodoStore, todoId: string): Todo | undefined {
  const todo = store.getTodo(todoId);
  if (!todo) return undefined;
  
  if (todo.status !== 'in_progress') {
    throw new Error(`Cannot unclaim todo in status ${todo.status}`);
  }
  
  return store.updateTodo({
    id: todoId,
    status: 'pending',
    claimedBy: null,
  });
}

/**
 * Force claim a todo
 *
 * Use with caution - this will claim a todo even when another agent currently holds it.
 *
 * @param store - The todo store
 * @param todoId - The todo ID to claim
 * @param agentId - The agent ID claiming the todo
 * @returns The claim result
 */
export function forceClaimTodo(
  store: TodoStore,
  todoId: string,
  agentId: string
): TodoClaimResult {
  const todo = store.getTodo(todoId);

  if (!todo) {
    return { success: false, message: `Todo ${todoId} not found` };
  }

  if (todo.status !== 'pending' && todo.status !== 'in_progress') {
    return {
      success: false,
      message: `Todo ${todoId} is not claimable (current status: ${todo.status})`,
    };
  }

  // Claim the todo
  return store.claimTodo(todoId, agentId);
}

/**
 * Get the agent currently working on a todo
 * 
 * @param store - The todo store
 * @param todoId - The todo ID
 * @returns The agent ID or null if not claimed
 */
export function getTodoClaimant(store: TodoStore, todoId: string): string | null {
  const todo = store.getTodo(todoId);
  return todo?.claimedBy || null;
}

/**
 * Check if a todo is claimed
 * 
 * @param store - The todo store
 * @param todoId - The todo ID
 * @returns true if claimed, false otherwise
 */
export function isTodoClaimed(store: TodoStore, todoId: string): boolean {
  const todo = store.getTodo(todoId);
  return todo?.claimedBy !== null && todo?.claimedBy !== undefined;
}
