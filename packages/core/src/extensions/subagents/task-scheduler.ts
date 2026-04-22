/**
 * Task Scheduler - Automatic task scheduling for agents
 * 
 * Features:
 * - Auto-claim available tasks for idle agents
 * - Priority-based task selection
 * - Configurable concurrency limits
 * - Event-driven task assignment
 */

import type { TaskStore, Task, AgentStatus } from '../../runtime/tasks/types';
import { claimTask, getAvailableTasks, getAvailableTasksSorted } from '../../runtime/tasks';

/**
 * Scheduler configuration
 */
export interface TaskSchedulerConfig {
  /** Task store */
  store: TaskStore;
  /** Maximum concurrent tasks per agent */
  maxConcurrentPerAgent?: number;
  /** Polling interval in ms (0 = event-driven only) */
  pollingIntervalMs?: number;
  /** Callback when a task is assigned */
  onTaskAssigned?: (task: Task, agentId: string) => void;
  /** Callback when an agent becomes idle */
  onAgentIdle?: (agentId: string) => void;
}

/**
 * Agent scheduler state
 */
interface AgentSchedulerState {
  agentId: string;
  currentTasks: Set<string>;
  isProcessing: boolean;
}

/**
 * Task Scheduler for automatic task assignment
 */
export class TaskScheduler {
  private store: TaskStore;
  private maxConcurrentPerAgent: number;
  private pollingIntervalMs: number;
  private onTaskAssigned?: (task: Task, agentId: string) => void;
  private onAgentIdle?: (agentId: string) => void;
  
  private agents: Map<string, AgentSchedulerState> = new Map();
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(config: TaskSchedulerConfig) {
    this.store = config.store;
    this.maxConcurrentPerAgent = config.maxConcurrentPerAgent ?? 3;
    this.pollingIntervalMs = config.pollingIntervalMs ?? 5000;
    this.onTaskAssigned = config.onTaskAssigned;
    this.onAgentIdle = config.onAgentIdle;

    // Subscribe to task events
    this.store.subscribe(this.handleTaskEvent.bind(this));
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
   * Handle task events for event-driven scheduling
   */
  private handleTaskEvent(event: { type: string; task: Task }): void {
    if (!this.isRunning) return;

    switch (event.type) {
      case 'task:completed':
      case 'task:failed':
      case 'task:cancelled':
        // A task finished - check if we can assign new tasks to blocked agents
        this.processAgentTasks(event.task.claimedBy || '');
        break;
    }
  }

  /**
   * Poll for available tasks (used when pollingIntervalMs > 0)
   */
  private poll(): void {
    if (!this.isRunning) return;

    // Check all agents for available capacity
    for (const [agentId, state] of this.agents) {
      if (!state.isProcessing && state.currentTasks.size < this.maxConcurrentPerAgent) {
        this.processAgentTasks(agentId);
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
        currentTasks: new Set(),
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
      // Clear all tasks for this agent
      for (const taskId of state.currentTasks) {
        const task = this.store.getTask(taskId);
        if (task && task.claimedBy === agentId) {
          // Release the task back to pending
          this.store.updateTask({ id: taskId, claimedBy: null, status: 'pending' });
        }
      }
      this.agents.delete(agentId);
    }
  }

  /**
   * Update agent's current tasks
   */
  updateAgentTasks(agentId: string, taskIds: string[]): void {
    const state = this.agents.get(agentId);
    if (state) {
      state.currentTasks = new Set(taskIds);
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
   * Process tasks for a specific agent
   */
  private processAgentTasks(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    // Check if agent has capacity
    if (state.currentTasks.size >= this.maxConcurrentPerAgent) {
      return;
    }

    // Check if agent status is busy
    const agentStatus = this.store.getAgentStatus(agentId);
    if (agentStatus.isBusy) {
      return;
    }

    // Get available tasks sorted by priority
    const availableTasks = getAvailableTasksSorted(this.store);

    // Find a task that this agent isn't already working on
    for (const task of availableTasks) {
      if (!state.currentTasks.has(task.id)) {
        // Try to claim the task
        const result = claimTask(this.store, task.id, agentId);
        if (result.success) {
          state.currentTasks.add(task.id);
          this.onTaskAssigned?.(task, agentId);

          // Check if we can assign more
          if (state.currentTasks.size < this.maxConcurrentPerAgent) {
            // Recursively try to assign more
            this.processAgentTasks(agentId);
          }
          break;
        }
      }
    }

    // If no tasks were assigned and agent was idle, notify
    if (state.currentTasks.size === 0) {
      this.onAgentIdle?.(agentId);
    }
  }

  /**
   * Manually trigger scheduling for all agents
   */
  scheduleAll(): void {
    for (const [agentId] of this.agents) {
      this.processAgentTasks(agentId);
    }
  }

  /**
   * Get scheduler statistics
   */
  getStats(): {
    totalAgents: number;
    totalTasks: number;
    availableTasks: number;
    inProgressTasks: number;
    completedTasks: number;
  } {
    const allTasks = this.store.getAllTasks();
    return {
      totalAgents: this.agents.size,
      totalTasks: allTasks.length,
      availableTasks: getAvailableTasks(this.store).length,
      inProgressTasks: allTasks.filter(t => t.status === 'in_progress').length,
      completedTasks: allTasks.filter(t => t.status === 'completed').length,
    };
  }
}

/**
 * Create a task scheduler
 */
export function createTaskScheduler(config: TaskSchedulerConfig): TaskScheduler {
  return new TaskScheduler(config);
}
