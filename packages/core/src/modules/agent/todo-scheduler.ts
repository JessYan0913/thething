/**
 * Todo Scheduler - Automatic todo scheduling for agents
 * 
 * Features:
 * - Auto-claim available todos for idle agents
 * - Priority-based todo selection
 * - Configurable concurrency limits
 * - Event-driven todo assignment
 */

import type { TodoStore, Todo, AgentStatus } from '../../modules/todos/types';
import { claimTodo, getAvailableTodos, getAvailableTodosSorted } from '../../modules/todos';

/**
 * Scheduler configuration
 */
export interface TodoSchedulerConfig {
  /** Todo store */
  store: TodoStore;
  /** Maximum concurrent todos per agent */
  maxConcurrentPerAgent?: number;
  /** Polling interval in ms (0 = event-driven only) */
  pollingIntervalMs?: number;
  /** Callback when a todo is assigned */
  onTodoAssigned?: (todo: Todo, agentId: string) => void;
  /** Callback when an agent becomes idle */
  onAgentIdle?: (agentId: string) => void;
}

/**
 * Agent scheduler state
 */
interface AgentSchedulerState {
  agentId: string;
  currentTodos: Set<string>;
  isProcessing: boolean;
}

/**
 * Todo Scheduler for automatic todo assignment
 */
export class TodoScheduler {
  private store: TodoStore;
  private maxConcurrentPerAgent: number;
  private pollingIntervalMs: number;
  private onTodoAssigned?: (todo: Todo, agentId: string) => void;
  private onAgentIdle?: (agentId: string) => void;
  
  private agents: Map<string, AgentSchedulerState> = new Map();
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(config: TodoSchedulerConfig) {
    this.store = config.store;
    this.maxConcurrentPerAgent = config.maxConcurrentPerAgent ?? 3;
    this.pollingIntervalMs = config.pollingIntervalMs ?? 5000;
    this.onTodoAssigned = config.onTodoAssigned;
    this.onAgentIdle = config.onAgentIdle;

    // Subscribe to todo events
    this.store.subscribe(this.handleTodoEvent.bind(this));
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.pollingIntervalMs > 0) {
      this.pollingInterval = setInterval(() => {
        this.poll();
      }, this.pollingIntervalMs);
    }
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Handle todo events for event-driven scheduling
   */
  private handleTodoEvent(event: { type: string; todo: Todo }): void {
    if (!this.isRunning) return;

    switch (event.type) {
      case 'todo:completed':
      case 'todo:failed':
      case 'todo:cancelled':
        // A todo finished - check if we can assign new todos to blocked agents
        this.processAgentTodos(event.todo.claimedBy || '');
        break;
    }
  }

  /**
   * Poll for available todos (used when pollingIntervalMs > 0)
   */
  private poll(): void {
    if (!this.isRunning) return;

    // Check all agents for available capacity
    for (const [agentId, state] of this.agents) {
      if (!state.isProcessing && state.currentTodos.size < this.maxConcurrentPerAgent) {
        this.processAgentTodos(agentId);
      }
    }
  }

  /**
   * Register an agent with the scheduler
   */
  registerAgent(agentId: string): void {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, {
        agentId,
        currentTodos: new Set(),
        isProcessing: false,
      });
    }
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    const state = this.agents.get(agentId);
    if (state) {
      // Clear all todos for this agent
      for (const todoId of state.currentTodos) {
        const todo = this.store.getTodo(todoId);
        if (todo && todo.claimedBy === agentId) {
          // Release the todo back to pending
          this.store.updateTodo({ id: todoId, claimedBy: null, status: 'pending' });
        }
      }
      this.agents.delete(agentId);
    }
  }

  /**
   * Update agent's current todos
   */
  updateAgentTodos(agentId: string, todoIds: string[]): void {
    const state = this.agents.get(agentId);
    if (state) {
      state.currentTodos = new Set(todoIds);
    }
  }

  /**
   * Mark agent as processing (busy)
   */
  setAgentProcessing(agentId: string, isProcessing: boolean): void {
    const state = this.agents.get(agentId);
    if (state) {
      state.isProcessing = isProcessing;
    }
  }

  /**
   * Process todos for a specific agent
   */
  private processAgentTodos(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    // Check if agent has capacity
    if (state.currentTodos.size >= this.maxConcurrentPerAgent) {
      return;
    }

    // Check if agent status is busy
    const agentStatus = this.store.getAgentStatus(agentId);
    if (agentStatus.isBusy) {
      return;
    }

    // Get available todos sorted by priority
    const availableTodos = getAvailableTodosSorted(this.store);

    // Find a todo that this agent isn't already working on
    for (const todo of availableTodos) {
      if (!state.currentTodos.has(todo.id)) {
        // Try to claim the todo
        const result = claimTodo(this.store, todo.id, agentId);
        if (result.success) {
          state.currentTodos.add(todo.id);
          this.onTodoAssigned?.(todo, agentId);

          // Check if we can assign more
          if (state.currentTodos.size < this.maxConcurrentPerAgent) {
            // Recursively try to assign more
            this.processAgentTodos(agentId);
          }
          break;
        }
      }
    }

    // If no todos were assigned and agent was idle, notify
    if (state.currentTodos.size === 0) {
      this.onAgentIdle?.(agentId);
    }
  }

  /**
   * Manually trigger scheduling for all agents
   */
  scheduleAll(): void {
    for (const [agentId] of this.agents) {
      this.processAgentTodos(agentId);
    }
  }

  /**
   * Get scheduler statistics
   */
  getStats(): {
    totalAgents: number;
    totalTodos: number;
    availableTodos: number;
    inProgressTodos: number;
    completedTodos: number;
  } {
    const allTodos = this.store.getAllTodos();
    return {
      totalAgents: this.agents.size,
      totalTodos: allTodos.length,
      availableTodos: getAvailableTodos(this.store).length,
      inProgressTodos: allTodos.filter(t => t.status === 'in_progress').length,
      completedTodos: allTodos.filter(t => t.status === 'completed').length,
    };
  }
}

/**
 * Create a todo scheduler
 */
export function createTodoScheduler(config: TodoSchedulerConfig): TodoScheduler {
  return new TodoScheduler(config);
}
