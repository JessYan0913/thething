/**
 * Todo Management System Types
 *
 * Re-exports core todo types from primitives (the storage layer).
 * Runtime-specific event types are also re-exported from primitives.
 */

// Core todo data types (re-exported from primitives)
export {
  type TodoStatus,
  type TodoPriority,
  type TodoMetadata,
  type Todo,
  type TodoCreateInput,
  type TodoUpdateInput,
  type TodoClaimResult,
  type TodoStore,
  type TodoEvent,
  type TodoEventListener,
  type TodoEventType,
} from '../../primitives/datastore/types';

import type { Todo, TodoStatus } from '../../primitives/datastore/types';

// ============================================================
// Runtime-specific Types
// ============================================================

/**
 * Result of getting available todos
 */
export interface TodoListResult {
  /** List of available todos */
  todos: Todo[];
  /** Total count */
  total: number;
}

/**
 * Todo status configuration
 */
export const STATUS_CONFIG: Record<TodoStatus, { label: string; color: string; icon: string }> = {
  pending: { label: 'Pending', color: '#6B7280', icon: '⏳' },
  in_progress: { label: 'In Progress', color: '#D4862B', icon: '🔄' },
  completed: { label: 'Completed', color: '#10B981', icon: '✅' },
  failed: { label: 'Failed', color: '#EF4444', icon: '❌' },
  cancelled: { label: 'Cancelled', color: '#9CA3AF', icon: '🚫' },
};
