import type {
  Todo,
  TodoStore,
  TodoCreateInput,
  TodoUpdateInput,
  TodoClaimResult,
  TodoEvent,
  TodoEventListener,
  TodoStatus,
  AgentStatus,
} from './types';
import { HighWaterMarkImpl, getGlobalHighWaterMark } from './high-water-mark';
import { logger } from '../../primitives/logger';

/**
 * In-memory TodoStore implementation
 * 
 * Features:
 * - Doubly-linked dependency tracking (blockedBy / blocks)
 * - Agent busy status tracking
 * - Event subscription for state changes
 * - Automatic unblocking of dependent todos
 */
export class InMemoryTodoStore implements TodoStore {
  private todos: Map<string, Todo> = new Map();
  private hwm: HighWaterMarkImpl;
  private agentStatus: Map<string, AgentStatus> = new Map();
  private listeners: Set<TodoEventListener> = new Set();

  constructor(hwm?: HighWaterMarkImpl) {
    this.hwm = hwm || getGlobalHighWaterMark();
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: TodoEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('TodoStore', 'Error in todo event listener:', error);
      }
    }
  }

  /**
   * Emit a todo event
   */
  private emitTodoEvent(type: TodoEvent['type'], todo: Todo, metadata?: Record<string, unknown>): void {
    this.emit({
      type,
      todo,
      timestamp: Date.now(),
      metadata,
    });
  }

  createTodo(input: TodoCreateInput): Todo {
    const now = Date.now();
    const id = this.hwm.next();

    // Validate blockedBy todos exist and belong to same conversation
    const blockedBy = input.blockedBy || [];
    for (const blockedById of blockedBy) {
      const existingTodo = this.todos.get(blockedById);
      if (!existingTodo) {
        throw new Error(`BlockedBy todo ${blockedById} does not exist`);
      }
      if (existingTodo.conversationId !== input.conversationId) {
        throw new Error(`Cannot create dependency across conversations`);
      }
    }

    const todo: Todo = {
      id,
      conversationId: input.conversationId,
      subject: input.subject,
      status: 'pending',
      claimedBy: null,
      activeForm: null,
      blockedBy,
      blocks: [], // Will be populated by updating blockedBy todos
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      metadata: input.metadata || {},
    };

    // Add this todo to the blocks list of all blockedBy todos
    for (const blockedById of blockedBy) {
      const blockedByTodo = this.todos.get(blockedById)!;
      blockedByTodo.blocks.push(id);
    }

    this.todos.set(id, todo);
    this.emitTodoEvent('todo:created', todo);

    return todo;
  }

  getTodo(id: string): Todo | undefined {
    return this.todos.get(id);
  }

  getAllTodos(): Todo[] {
    return Array.from(this.todos.values());
  }

  /**
   * Get todos for a specific conversation
   */
  getTodosByConversation(conversationId: string): Todo[] {
    return Array.from(this.todos.values()).filter(
      (todo) => todo.conversationId === conversationId
    );
  }

  updateTodo(input: TodoUpdateInput): Todo | undefined {
    const todo = this.todos.get(input.id);
    if (!todo) {
      return undefined;
    }

    const oldStatus = todo.status;
    const now = Date.now();

    // Handle blockedBy changes
    if (input.blockedBy !== undefined) {
      // Remove this todo from old blockedBy todos' blocks list
      for (const oldBlockedById of todo.blockedBy) {
        const oldBlockedByTodo = this.todos.get(oldBlockedById);
        if (oldBlockedByTodo) {
          oldBlockedByTodo.blocks = oldBlockedByTodo.blocks.filter(b => b !== todo.id);
        }
      }

      // Validate new blockedBy todos exist
      for (const newBlockedById of input.blockedBy) {
        if (!this.todos.has(newBlockedById)) {
          throw new Error(`BlockedBy todo ${newBlockedById} does not exist`);
        }
      }

      // Add this todo to new blockedBy todos' blocks list
      for (const newBlockedById of input.blockedBy) {
        const newBlockedByTodo = this.todos.get(newBlockedById)!;
        if (!newBlockedByTodo.blocks.includes(todo.id)) {
          newBlockedByTodo.blocks.push(todo.id);
        }
      }

      todo.blockedBy = input.blockedBy;
    }

    // Update other fields
    if (input.status !== undefined) {
      todo.status = input.status;
      if (input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled') {
        todo.completedAt = now;
        // Unclaim the todo
        if (todo.claimedBy) {
          this.setAgentBusy(todo.claimedBy, false, todo.id);
        }
        todo.claimedBy = null;
      }
    }

    if (input.subject !== undefined) {
      todo.subject = input.subject;
    }

    if (input.activeForm !== undefined) {
      todo.activeForm = input.activeForm;
    }

    if (input.claimedBy !== undefined) {
      // Handle agent busy status
      if (todo.claimedBy && input.claimedBy !== todo.claimedBy) {
        // Old agent is now free
        this.setAgentBusy(todo.claimedBy, false, todo.id);
      }
      if (input.claimedBy) {
        // New agent is now busy
        this.setAgentBusy(input.claimedBy, true, todo.id);
      }
      todo.claimedBy = input.claimedBy;
    }

    if (input.metadata !== undefined) {
      todo.metadata = { ...todo.metadata, ...input.metadata };
    }

    todo.updatedAt = now;
    this.emitTodoEvent('todo:updated', todo);

    // Emit specific status change events
    if (input.status !== undefined && input.status !== oldStatus) {
      switch (input.status) {
        case 'completed':
          this.emitTodoEvent('todo:completed', todo);
          // Unblock dependent todos
          this.unblockDependents(todo.id);
          break;
        case 'failed':
          this.emitTodoEvent('todo:failed', todo);
          break;
        case 'cancelled':
          this.emitTodoEvent('todo:cancelled', todo);
          break;
      }
    }

    return todo;
  }

  /**
   * Unblock todos that were waiting for this todo to complete
   */
  private unblockDependents(todoId: string): void {
    const todo = this.todos.get(todoId);
    if (!todo) return;

    for (const dependentId of todo.blocks) {
      const dependentTodo = this.todos.get(dependentId);
      if (dependentTodo && dependentTodo.status === 'pending') {
        // Check if all blockedBy todos are now completed
        const allDependenciesMet = dependentTodo.blockedBy.every(
          blockedById => {
            const blockedByTodo = this.todos.get(blockedById);
            return blockedByTodo && blockedByTodo.status === 'completed';
          }
        );

        if (allDependenciesMet) {
          // Todo is now unblocked - could emit an event here if needed
          this.emitTodoEvent('todo:updated', dependentTodo, { unblocked: true });
        }
      }
    }
  }

  deleteTodo(id: string): boolean {
    const todo = this.todos.get(id);
    if (!todo) {
      return false;
    }

    // Remove this todo from all blockedBy todos' blocks list
    for (const blockedById of todo.blockedBy) {
      const blockedByTodo = this.todos.get(blockedById);
      if (blockedByTodo) {
        blockedByTodo.blocks = blockedByTodo.blocks.filter(b => b !== id);
      }
    }

    // Remove this todo from all blocks todos' blockedBy list
    for (const blocksId of todo.blocks) {
      const blocksTodo = this.todos.get(blocksId);
      if (blocksTodo) {
        blocksTodo.blockedBy = blocksTodo.blockedBy.filter(b => b !== id);
      }
    }

    // If todo was claimed, free the agent
    if (todo.claimedBy) {
      this.setAgentBusy(todo.claimedBy, false, id);
    }

    this.emitTodoEvent('todo:deleted', todo);
    return this.todos.delete(id);
  }

  claimTodo(todoId: string, agentId: string): TodoClaimResult {
    const todo = this.todos.get(todoId);

    if (!todo) {
      return { success: false, message: `Todo ${todoId} not found` };
    }

    // Check if agent is already busy
    const agentStatus = this.getAgentStatus(agentId);
    if (agentStatus.isBusy) {
      return {
        success: false,
        message: `Agent ${agentId} is already busy with todo ${agentStatus.currentTodoId}`,
      };
    }

    // Check if todo is pending
    if (todo.status !== 'pending') {
      return {
        success: false,
        message: `Todo ${todoId} is not pending (current status: ${todo.status})`,
      };
    }

    // Check if all dependencies are met
    const allDependenciesMet = todo.blockedBy.every(blockedById => {
      const blockedByTodo = this.todos.get(blockedById);
      return blockedByTodo && blockedByTodo.status === 'completed';
    });

    if (!allDependenciesMet) {
      const unmetDeps = todo.blockedBy.filter(blockedById => {
        const blockedByTodo = this.todos.get(blockedById);
        return !blockedByTodo || blockedByTodo.status !== 'completed';
      });
      return {
        success: false,
        message: `Todo ${todoId} is blocked by incomplete dependencies: ${unmetDeps.join(', ')}`,
      };
    }

    // Check if todo is already claimed
    if (todo.claimedBy) {
      return {
        success: false,
        message: `Todo ${todoId} is already claimed by agent ${todo.claimedBy}`,
      };
    }

    // Claim the todo
    todo.claimedBy = agentId;
    todo.status = 'in_progress';
    todo.updatedAt = Date.now();

    // Update agent status
    this.setAgentBusy(agentId, true, todoId);

    this.emitTodoEvent('todo:claimed', todo);
    return { success: true, todo };
  }

  getAvailableTodos(): Todo[] {
    return this.getAllTodos().filter(todo => {
      // Must be pending
      if (todo.status !== 'pending') return false;

      // Must not be claimed
      if (todo.claimedBy) return false;

      // All blockedBy todos must be completed
      return todo.blockedBy.every(blockedById => {
        const blockedByTodo = this.todos.get(blockedById);
        return blockedByTodo && blockedByTodo.status === 'completed';
      });
    });
  }

  getTodosByStatus(status: TodoStatus): Todo[] {
    return this.getAllTodos().filter(todo => todo.status === status);
  }

  getTodosByAgent(agentId: string): Todo[] {
    return this.getAllTodos().filter(todo => todo.claimedBy === agentId);
  }

  getBlockingTodos(todoId: string): Todo[] {
    const todo = this.todos.get(todoId);
    if (!todo) return [];
    return todo.blocks.map(id => this.todos.get(id)).filter((t): t is Todo => t !== undefined);
  }

  getBlockedByTodos(todoId: string): Todo[] {
    const todo = this.todos.get(todoId);
    if (!todo) return [];
    return todo.blockedBy.map(id => this.todos.get(id)).filter((t): t is Todo => t !== undefined);
  }

  subscribe(listener: TodoEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getAgentStatus(agentId: string): AgentStatus {
    const status = this.agentStatus.get(agentId);
    return status || { agentId, isBusy: false, currentTodoId: null };
  }

  setAgentBusy(agentId: string, busy: boolean, todoId?: string): void {
    if (busy) {
      this.agentStatus.set(agentId, {
        agentId,
        isBusy: true,
        currentTodoId: todoId || null,
      });
    } else {
      this.agentStatus.delete(agentId);
    }
  }

  clearAllTodos(): void {
    this.todos.clear();
    this.agentStatus.clear();
    this.hwm.reset(1);
  }
}

/**
 * Create a new TodoStore instance
 */
export function createTodoStore(hwm?: HighWaterMarkImpl): TodoStore {
  return new InMemoryTodoStore(hwm);
}
