import type {
  Task,
  TaskStore,
  TaskCreateInput,
  TaskUpdateInput,
  TaskClaimResult,
  TaskListResult,
  TaskEvent,
  TaskEventListener,
  TaskStatus,
  AgentStatus,
} from './types';
import { HighWaterMarkImpl, getGlobalHighWaterMark } from './high-water-mark';

/**
 * In-memory TaskStore implementation
 * 
 * Features:
 * - Doubly-linked dependency tracking (blockedBy / blocks)
 * - Agent busy status tracking
 * - Event subscription for state changes
 * - Automatic unblocking of dependent tasks
 */
export class InMemoryTaskStore implements TaskStore {
  private tasks: Map<string, Task> = new Map();
  private hwm: HighWaterMarkImpl;
  private agentStatus: Map<string, AgentStatus> = new Map();
  private listeners: Set<TaskEventListener> = new Set();

  constructor(hwm?: HighWaterMarkImpl) {
    this.hwm = hwm || getGlobalHighWaterMark();
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: TaskEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in task event listener:', error);
      }
    }
  }

  /**
   * Emit a task event
   */
  private emitTaskEvent(type: TaskEvent['type'], task: Task, metadata?: Record<string, unknown>): void {
    this.emit({
      type,
      task,
      timestamp: Date.now(),
      metadata,
    });
  }

  createTask(input: TaskCreateInput): Task {
    const now = Date.now();
    const id = this.hwm.next();

    // Validate blockedBy tasks exist
    const blockedBy = input.blockedBy || [];
    for (const blockedById of blockedBy) {
      if (!this.tasks.has(blockedById)) {
        throw new Error(`BlockedBy task ${blockedById} does not exist`);
      }
    }

    const task: Task = {
      id,
      subject: input.subject,
      status: 'pending',
      claimedBy: null,
      activeForm: null,
      blockedBy,
      blocks: [], // Will be populated by updating blockedBy tasks
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      metadata: input.metadata || {},
    };

    // Add this task to the blocks list of all blockedBy tasks
    for (const blockedById of blockedBy) {
      const blockedByTask = this.tasks.get(blockedById)!;
      blockedByTask.blocks.push(id);
    }

    this.tasks.set(id, task);
    this.emitTaskEvent('task:created', task);

    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  updateTask(input: TaskUpdateInput): Task | undefined {
    const task = this.tasks.get(input.id);
    if (!task) {
      return undefined;
    }

    const oldStatus = task.status;
    const now = Date.now();

    // Handle blockedBy changes
    if (input.blockedBy !== undefined) {
      // Remove this task from old blockedBy tasks' blocks list
      for (const oldBlockedById of task.blockedBy) {
        const oldBlockedByTask = this.tasks.get(oldBlockedById);
        if (oldBlockedByTask) {
          oldBlockedByTask.blocks = oldBlockedByTask.blocks.filter(b => b !== task.id);
        }
      }

      // Validate new blockedBy tasks exist
      for (const newBlockedById of input.blockedBy) {
        if (!this.tasks.has(newBlockedById)) {
          throw new Error(`BlockedBy task ${newBlockedById} does not exist`);
        }
      }

      // Add this task to new blockedBy tasks' blocks list
      for (const newBlockedById of input.blockedBy) {
        const newBlockedByTask = this.tasks.get(newBlockedById)!;
        if (!newBlockedByTask.blocks.includes(task.id)) {
          newBlockedByTask.blocks.push(task.id);
        }
      }

      task.blockedBy = input.blockedBy;
    }

    // Update other fields
    if (input.status !== undefined) {
      task.status = input.status;
      if (input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled') {
        task.completedAt = now;
        // Unclaim the task
        if (task.claimedBy) {
          this.setAgentBusy(task.claimedBy, false, task.id);
        }
        task.claimedBy = null;
      }
    }

    if (input.subject !== undefined) {
      task.subject = input.subject;
    }

    if (input.activeForm !== undefined) {
      task.activeForm = input.activeForm;
    }

    if (input.claimedBy !== undefined) {
      // Handle agent busy status
      if (task.claimedBy && input.claimedBy !== task.claimedBy) {
        // Old agent is now free
        this.setAgentBusy(task.claimedBy, false, task.id);
      }
      if (input.claimedBy) {
        // New agent is now busy
        this.setAgentBusy(input.claimedBy, true, task.id);
      }
      task.claimedBy = input.claimedBy;
    }

    if (input.metadata !== undefined) {
      task.metadata = { ...task.metadata, ...input.metadata };
    }

    task.updatedAt = now;
    this.emitTaskEvent('task:updated', task);

    // Emit specific status change events
    if (input.status !== undefined && input.status !== oldStatus) {
      switch (input.status) {
        case 'completed':
          this.emitTaskEvent('task:completed', task);
          // Unblock dependent tasks
          this.unblockDependents(task.id);
          break;
        case 'failed':
          this.emitTaskEvent('task:failed', task);
          break;
        case 'cancelled':
          this.emitTaskEvent('task:cancelled', task);
          break;
      }
    }

    return task;
  }

  /**
   * Unblock tasks that were waiting for this task to complete
   */
  private unblockDependents(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    for (const dependentId of task.blocks) {
      const dependentTask = this.tasks.get(dependentId);
      if (dependentTask && dependentTask.status === 'pending') {
        // Check if all blockedBy tasks are now completed
        const allDependenciesMet = dependentTask.blockedBy.every(
          blockedById => {
            const blockedByTask = this.tasks.get(blockedById);
            return blockedByTask && blockedByTask.status === 'completed';
          }
        );

        if (allDependenciesMet) {
          // Task is now unblocked - could emit an event here if needed
          this.emitTaskEvent('task:updated', dependentTask, { unblocked: true });
        }
      }
    }
  }

  deleteTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    // Remove this task from all blockedBy tasks' blocks list
    for (const blockedById of task.blockedBy) {
      const blockedByTask = this.tasks.get(blockedById);
      if (blockedByTask) {
        blockedByTask.blocks = blockedByTask.blocks.filter(b => b !== id);
      }
    }

    // Remove this task from all blocks tasks' blockedBy list
    for (const blocksId of task.blocks) {
      const blocksTask = this.tasks.get(blocksId);
      if (blocksTask) {
        blocksTask.blockedBy = blocksTask.blockedBy.filter(b => b !== id);
      }
    }

    // If task was claimed, free the agent
    if (task.claimedBy) {
      this.setAgentBusy(task.claimedBy, false, id);
    }

    this.emitTaskEvent('task:deleted', task);
    return this.tasks.delete(id);
  }

  claimTask(taskId: string, agentId: string): TaskClaimResult {
    const task = this.tasks.get(taskId);

    if (!task) {
      return { success: false, message: `Task ${taskId} not found` };
    }

    // Check if agent is already busy
    const agentStatus = this.getAgentStatus(agentId);
    if (agentStatus.isBusy) {
      return {
        success: false,
        message: `Agent ${agentId} is already busy with task ${agentStatus.currentTaskId}`,
      };
    }

    // Check if task is pending
    if (task.status !== 'pending') {
      return {
        success: false,
        message: `Task ${taskId} is not pending (current status: ${task.status})`,
      };
    }

    // Check if all dependencies are met
    const allDependenciesMet = task.blockedBy.every(blockedById => {
      const blockedByTask = this.tasks.get(blockedById);
      return blockedByTask && blockedByTask.status === 'completed';
    });

    if (!allDependenciesMet) {
      const unmetDeps = task.blockedBy.filter(blockedById => {
        const blockedByTask = this.tasks.get(blockedById);
        return !blockedByTask || blockedByTask.status !== 'completed';
      });
      return {
        success: false,
        message: `Task ${taskId} is blocked by incomplete dependencies: ${unmetDeps.join(', ')}`,
      };
    }

    // Check if task is already claimed
    if (task.claimedBy) {
      return {
        success: false,
        message: `Task ${taskId} is already claimed by agent ${task.claimedBy}`,
      };
    }

    // Claim the task
    task.claimedBy = agentId;
    task.status = 'in_progress';
    task.updatedAt = Date.now();

    // Update agent status
    this.setAgentBusy(agentId, true, taskId);

    this.emitTaskEvent('task:claimed', task);
    return { success: true, task };
  }

  getAvailableTasks(): Task[] {
    return this.getAllTasks().filter(task => {
      // Must be pending
      if (task.status !== 'pending') return false;

      // Must not be claimed
      if (task.claimedBy) return false;

      // All blockedBy tasks must be completed
      return task.blockedBy.every(blockedById => {
        const blockedByTask = this.tasks.get(blockedById);
        return blockedByTask && blockedByTask.status === 'completed';
      });
    });
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return this.getAllTasks().filter(task => task.status === status);
  }

  getTasksByAgent(agentId: string): Task[] {
    return this.getAllTasks().filter(task => task.claimedBy === agentId);
  }

  getBlockingTasks(taskId: string): Task[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    return task.blocks.map(id => this.tasks.get(id)).filter((t): t is Task => t !== undefined);
  }

  getBlockedByTasks(taskId: string): Task[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    return task.blockedBy.map(id => this.tasks.get(id)).filter((t): t is Task => t !== undefined);
  }

  subscribe(listener: TaskEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getAgentStatus(agentId: string): AgentStatus {
    const status = this.agentStatus.get(agentId);
    return status || { agentId, isBusy: false, currentTaskId: null };
  }

  setAgentBusy(agentId: string, busy: boolean, taskId?: string): void {
    if (busy) {
      this.agentStatus.set(agentId, {
        agentId,
        isBusy: true,
        currentTaskId: taskId || null,
      });
    } else {
      this.agentStatus.delete(agentId);
    }
  }

  clearAllTasks(): void {
    this.tasks.clear();
    this.agentStatus.clear();
    this.hwm.reset(1);
  }
}

/**
 * Create a new TaskStore instance
 */
export function createTaskStore(hwm?: HighWaterMarkImpl): TaskStore {
  return new InMemoryTaskStore(hwm);
}

/**
 * Global TaskStore instance
 */
let globalTaskStore: TaskStore | null = null;

export function getGlobalTaskStore(): TaskStore {
  if (!globalTaskStore) {
    globalTaskStore = createTaskStore();
  }
  return globalTaskStore;
}

export function setGlobalTaskStore(store: TaskStore): void {
  globalTaskStore = store;
}
