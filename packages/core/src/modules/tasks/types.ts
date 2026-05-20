/**
 * Task Management System Types
 *
 * Re-exports core task types from primitives (the storage layer).
 * Runtime-specific event types are also re-exported from primitives.
 */

// Core task data types (re-exported from primitives)
export {
  type TaskStatus,
  type TaskPriority,
  type TaskMetadata,
  type Task,
  type TaskCreateInput,
  type TaskUpdateInput,
  type TaskClaimResult,
  type TaskStore,
  type AgentStatus,
  type TaskEvent,
  type TaskEventListener,
  type TaskEventType,
} from '../../primitives/datastore/types';

import type { Task, TaskStatus } from '../../primitives/datastore/types';

// ============================================================
// Constants
// ============================================================

/** Task ID 前缀 */
export const TASK_ID_PREFIX = '';

// ============================================================
// Runtime-specific Types
// ============================================================

/**
 * Result of getting available tasks
 */
export interface TaskListResult {
  /** List of available tasks */
  tasks: Task[];
  /** Total count */
  total: number;
}

/**
 * HighWaterMark interface for ID generation
 */
export interface HighWaterMark {
  /** Get the next unique ID */
  next(): string;
  /** Get the current value without incrementing */
  current(): number;
  /** Reset to a specific value */
  reset(value: number): void;
}

/**
 * Task status configuration
 */
export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; icon: string }> = {
  pending: { label: 'Pending', color: '#6B7280', icon: '⏳' },
  in_progress: { label: 'In Progress', color: '#3B82F6', icon: '🔄' },
  completed: { label: 'Completed', color: '#10B981', icon: '✅' },
  failed: { label: 'Failed', color: '#EF4444', icon: '❌' },
  cancelled: { label: 'Cancelled', color: '#9CA3AF', icon: '🚫' },
};
