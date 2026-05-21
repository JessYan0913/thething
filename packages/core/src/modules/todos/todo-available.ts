import type { TodoStore, Todo, TodoStatus, TodoListResult } from './types';

/**
 * Get all available todos for an agent to claim
 * 
 * A todo is available if:
 * - Status is 'pending'
 * - Not claimed by any agent
 * - All blockedBy dependencies are 'completed'
 * 
 * @param store - The todo store
 * @returns Array of available todos
 * 
 * @example
 * ```typescript
 * const available = getAvailableTodos(store);
 * ```
 */
export function getAvailableTodos(store: TodoStore): Todo[] {
  return store.getAvailableTodos();
}

/**
 * Get available todos sorted by priority
 * 
 * @param store - The todo store
 * @returns Array of available todos sorted by priority (high first)
 */
export function getAvailableTodosSorted(store: TodoStore): Todo[] {
  const todos = store.getAvailableTodos();
  
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  
  return todos.sort((a, b) => {
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
 * Get next available todo for an agent
 * 
 * Returns the highest priority available todo.
 * 
 * @param store - The todo store
 * @returns The next todo to work on or undefined if none available
 */
export function getNextAvailableTodo(store: TodoStore): Todo | undefined {
  const sorted = getAvailableTodosSorted(store);
  return sorted[0];
}

/**
 * Get todos by status
 * 
 * @param store - The todo store
 * @param status - The status to filter by
 * @returns Array of todos with the given status
 */
export function getTodosByStatus(store: TodoStore, status: TodoStatus): Todo[] {
  return store.getTodosByStatus(status);
}

/**
 * Get all pending todos (including blocked ones)
 * 
 * @param store - The todo store
 * @returns Array of all pending todos
 */
export function getAllPendingTodos(store: TodoStore): Todo[] {
  return store.getTodosByStatus('pending');
}

/**
 * Get all in-progress todos
 * 
 * @param store - The todo store
 * @returns Array of all in-progress todos
 */
export function getAllInProgressTodos(store: TodoStore): Todo[] {
  return store.getTodosByStatus('in_progress');
}

/**
 * Get all completed todos
 * 
 * @param store - The todo store
 * @returns Array of all completed todos
 */
export function getAllCompletedTodos(store: TodoStore): Todo[] {
  return store.getTodosByStatus('completed');
}

/**
 * Get all failed todos
 * 
 * @param store - The todo store
 * @returns Array of all failed todos
 */
export function getAllFailedTodos(store: TodoStore): Todo[] {
  return store.getTodosByStatus('failed');
}

/**
 * Get todos grouped by status
 * 
 * @param store - The todo store
 * @returns Object with status as key and array of todos as value
 */
export function getTodosGroupedByStatus(store: TodoStore): Record<TodoStatus, Todo[]> {
  const todos = store.getAllTodos();
  
  const result: Record<TodoStatus, Todo[]> = {
    pending: [],
    in_progress: [],
    completed: [],
    failed: [],
    cancelled: [],
  };
  
  for (const todo of todos) {
    result[todo.status].push(todo);
  }
  
  return result;
}

/**
 * Get todo list result with statistics
 * 
 * @param store - The todo store
 * @param options - Optional filters
 * @returns Todo list result with todos and counts
 */
export function getTodoListResult(
  store: TodoStore,
  options?: {
    status?: TodoStatus;
    available?: boolean;
    agentId?: string;
  }
): TodoListResult {
  let todos: Todo[];
  
  if (options?.available) {
    todos = getAvailableTodos(store);
  } else if (options?.status) {
    todos = store.getTodosByStatus(options.status);
  } else if (options?.agentId) {
    todos = store.getTodosByAgent(options.agentId);
  } else {
    todos = store.getAllTodos();
  }
  
  return {
    todos,
    total: todos.length,
  };
}

/**
 * Find a todo by subject (partial match)
 * 
 * @param store - The todo store
 * @param searchTerm - The search term
 * @returns Array of matching todos
 */
export function findTodosBySubject(store: TodoStore, searchTerm: string): Todo[] {
  const lowerSearch = searchTerm.toLowerCase();
  return store.getAllTodos().filter(todo =>
    todo.subject.toLowerCase().includes(lowerSearch)
  );
}

/**
 * Find a todo by exact subject
 * 
 * @param store - The todo store
 * @param subject - The exact subject to match
 * @returns The matching todo or undefined
 */
export function findTodoBySubject(store: TodoStore, subject: string): Todo | undefined {
  return store.getAllTodos().find(todo => todo.subject === subject);
}
