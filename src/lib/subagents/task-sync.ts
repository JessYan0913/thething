/**
 * Task Sync - Synchronizes task state with Sub-Agent execution
 * 
 * This module provides bidirectional sync between:
 * - Task status in the TaskStore
 * - Sub-Agent execution state
 * 
 * Features:
 * - Auto-update task status when sub-agent starts/completes
 * - Sync activeForm with current sub-agent activity
 * - Propagate sub-agent errors to task metadata
 */

import type { TaskStore, Task, TaskEvent } from '@/lib/tasks/types';
import { claimTask, setTaskActiveForm, completeTask, failTask } from '@/lib/tasks';

/**
 * Sub-agent result type (copied from agent-tool to avoid circular dependency)
 */
export interface AgentToolResult {
  success: boolean;
  summary: string;
  durationMs: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  error?: string;
}

/**
 * TaskSync configuration
 */
export interface TaskSyncConfig {
  /** Task store to sync with */
  store: TaskStore;
  /** Agent ID for this sync instance */
  agentId: string;
  /** Current task ID being worked on */
  currentTaskId: string | null;
}

/**
 * TaskSync instance for syncing task and sub-agent state
 */
export class TaskSync {
  private store: TaskStore;
  private agentId: string;
  private currentTaskId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private isSyncing = false;

  constructor(config: TaskSyncConfig) {
    this.store = config.store;
    this.agentId = config.agentId;
    this.currentTaskId = config.currentTaskId;
  }

  /**
   * Start syncing task events
   */
  start(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = this.store.subscribe(this.handleTaskEvent.bind(this));
  }

  /**
   * Stop syncing
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Handle incoming task events
   */
  private handleTaskEvent(event: TaskEvent): void {
    if (this.isSyncing) return;

    switch (event.type) {
      case 'task:claimed':
        if (event.task.claimedBy === this.agentId) {
          this.currentTaskId = event.task.id;
        }
        break;
      case 'task:completed':
      case 'task:failed':
      case 'task:cancelled':
        if (event.task.id === this.currentTaskId) {
          this.currentTaskId = null;
        }
        break;
    }
  }

  /**
   * Claim a task for execution
   */
  async claimTaskForExecution(taskId: string): Promise<{ success: boolean; error?: string }> {
    this.isSyncing = true;
    try {
      const result = claimTask(this.store, taskId, this.agentId);
      if (result.success) {
        this.currentTaskId = taskId;
      }
      return { success: result.success, error: result.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Update the active form (current activity)
   */
  updateActiveForm(activity: string): void {
    if (this.currentTaskId) {
      setTaskActiveForm(this.store, this.currentTaskId, activity);
    }
  }

  /**
   * Complete the current task
   */
  async completeCurrentTask(result: string): Promise<{ success: boolean; error?: string }> {
    if (!this.currentTaskId) {
      return { success: false, error: 'No current task to complete' };
    }

    this.isSyncing = true;
    try {
      completeTask(this.store, this.currentTaskId, result);
      this.currentTaskId = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Fail the current task
   */
  async failCurrentTask(error: string): Promise<{ success: boolean; error?: string }> {
    if (!this.currentTaskId) {
      return { success: false, error: 'No current task to fail' };
    }

    this.isSyncing = true;
    try {
      failTask(this.store, this.currentTaskId, error);
      this.currentTaskId = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync from sub-agent result
   */
  syncFromSubAgentResult(subAgentResult: AgentToolResult): void {
    if (!this.currentTaskId) return;

    if (subAgentResult.success) {
      completeTask(this.store, this.currentTaskId, subAgentResult.summary);
    } else {
      failTask(this.store, this.currentTaskId, subAgentResult.error || 'Unknown error');
    }
    this.currentTaskId = null;
  }

  /**
   * Get the current task ID
   */
  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  /**
   * Get the current task
   */
  getCurrentTask(): Task | undefined {
    if (!this.currentTaskId) return undefined;
    return this.store.getTask(this.currentTaskId);
  }
}

/**
 * Create a TaskSync instance
 */
export function createTaskSync(config: TaskSyncConfig): TaskSync {
  return new TaskSync(config);
}

/**
 * Create a task sync hook for React components
 */
export function useTaskSync(store: TaskStore, agentId: string): TaskSync {
  const sync = new TaskSync({ store, agentId, currentTaskId: null });
  sync.start();
  return sync;
}
