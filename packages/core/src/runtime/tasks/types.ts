/**
 * Task Management System Types
 * 
 * Re-exports core task types from foundation (the storage layer).
 * Runtime-specific event types remain here.
 */

// Core task data types (re-exported from foundation)
// Note: TaskEvent and TaskEventListener are runtime-specific (typed event types)
// and are defined locally in this file, not re-exported from foundation.
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
} from '../../foundation/datastore/types';

import type { Task, TaskStatus } from '../../foundation/datastore/types';

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
 * Task events for event-driven architecture
 */
export type TaskEventType = 
  | 'task:created'
  | 'task:updated'
  | 'task:deleted'
  | 'task:claimed'
  | 'task:completed'
  | 'task:failed'
  | 'task:cancelled'
  | 'task:stopped';

/**
 * Task event payload
 */
export interface TaskEvent {
  type: TaskEventType;
  task: Task;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Task event listener callback
 */
export type TaskEventListener = (event: TaskEvent) => void | Promise<void>;

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
 * Default HighWaterMark instance prefix
 */
export const TASK_ID_PREFIX = 'task-';

/**
 * Status display configuration
 */
export const STATUS_CONFIG: Record<import('../../foundation/datastore/types').TaskStatus, {
  icon: string;
  color: string;
  indicator: boolean;
  animation?: string;
}> = {
  pending: {
    icon: '○',
    color: 'text-gray-400',
    indicator: false,
  },
  in_progress: {
    icon: '◐',
    color: 'text-blue-500',
    indicator: false,
    animation: 'animate-spin',
  },
  completed: {
    icon: '●',
    color: 'text-green-500',
    indicator: true,
  },
  failed: {
    icon: '✕',
    color: 'text-red-500',
    indicator: false,
  },
  cancelled: {
    icon: '⊘',
    color: 'text-gray-400',
    indicator: false,
  },
};
