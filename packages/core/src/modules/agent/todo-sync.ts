/**
 * Todo Sync - Synchronizes todo state with Sub-Agent execution
 * 
 * This module provides bidirectional sync between:
 * - Todo status in the TodoStore
 * - Sub-Agent execution state
 * 
 * Features:
 * - Auto-update todo status when sub-agent starts/completes
 * - Sync activeForm with current sub-agent activity
 * - Propagate sub-agent errors to todo metadata
 */

import type { TodoStore, Todo, TodoEvent } from '../../modules/todos/types';
import { claimTodo, setTodoActiveForm, completeTodo, failTodo } from '../../modules/todos';

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
 * TodoSync configuration
 */
export interface TodoSyncConfig {
  /** Todo store to sync with */
  store: TodoStore;
  /** Agent ID for this sync instance */
  agentId: string;
  /** Current todo ID being worked on */
  currentTodoId: string | null;
}

/**
 * TodoSync instance for syncing todo and sub-agent state
 */
export class TodoSync {
  private store: TodoStore;
  private agentId: string;
  private currentTodoId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private isSyncing = false;

  constructor(config: TodoSyncConfig) {
    this.store = config.store;
    this.agentId = config.agentId;
    this.currentTodoId = config.currentTodoId;
  }

  /**
   * Start syncing todo events
   */
  start(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = this.store.subscribe(this.handleTodoEvent.bind(this) as Parameters<TodoStore['subscribe']>[0]);
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
   * Handle incoming todo events
   */
  private handleTodoEvent(event: TodoEvent): void {
    if (this.isSyncing) return;

    switch (event.type) {
      case 'todo:claimed':
        if (event.todo.claimedBy === this.agentId) {
          this.currentTodoId = event.todo.id;
        }
        break;
      case 'todo:completed':
      case 'todo:failed':
      case 'todo:cancelled':
        if (event.todo.id === this.currentTodoId) {
          this.currentTodoId = null;
        }
        break;
    }
  }

  /**
   * Claim a todo for execution
   */
  async claimTodoForExecution(todoId: string): Promise<{ success: boolean; error?: string }> {
    this.isSyncing = true;
    try {
      const result = claimTodo(this.store, todoId, this.agentId);
      if (result.success) {
        this.currentTodoId = todoId;
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
    if (this.currentTodoId) {
      setTodoActiveForm(this.store, this.currentTodoId, activity);
    }
  }

  /**
   * Complete the current todo
   */
  async completeCurrentTodo(result: string): Promise<{ success: boolean; error?: string }> {
    if (!this.currentTodoId) {
      return { success: false, error: 'No current todo to complete' };
    }

    this.isSyncing = true;
    try {
      completeTodo(this.store, this.currentTodoId, result);
      this.currentTodoId = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Fail the current todo
   */
  async failCurrentTodo(error: string): Promise<{ success: boolean; error?: string }> {
    if (!this.currentTodoId) {
      return { success: false, error: 'No current todo to fail' };
    }

    this.isSyncing = true;
    try {
      failTodo(this.store, this.currentTodoId, error);
      this.currentTodoId = null;
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
    if (!this.currentTodoId) return;

    if (subAgentResult.success) {
      completeTodo(this.store, this.currentTodoId, subAgentResult.summary);
    } else {
      failTodo(this.store, this.currentTodoId, subAgentResult.error || 'Unknown error');
    }
    this.currentTodoId = null;
  }

  /**
   * Get the current todo ID
   */
  getCurrentTodoId(): string | null {
    return this.currentTodoId;
  }

  /**
   * Get the current todo
   */
  getCurrentTodo(): Todo | undefined {
    if (!this.currentTodoId) return undefined;
    return this.store.getTodo(this.currentTodoId);
  }
}

/**
 * Create a TodoSync instance
 */
export function createTodoSync(config: TodoSyncConfig): TodoSync {
  return new TodoSync(config);
}

/**
 * Create a todo sync hook for React components
 */
export function useTodoSync(store: TodoStore, agentId: string): TodoSync {
  const sync = new TodoSync({ store, agentId, currentTodoId: null });
  sync.start();
  return sync;
}
