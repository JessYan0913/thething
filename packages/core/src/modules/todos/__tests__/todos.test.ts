import { describe, it, expect, beforeEach } from 'vitest';
import type { Todo, TodoStatus, TodoEvent } from '../types';
import { InMemoryTodoStore, createTodoStore } from '../store';

// ============================================================
// Todos Module Tests
// ============================================================
describe('todos', () => {
  describe('types', () => {
    describe('TodoStatus', () => {
      it('should have valid status values', () => {
        const statuses: TodoStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'];
        expect(statuses.length).toBe(5);
      });
    });

    describe('Todo interface', () => {
      it('should have required fields', () => {
        const todo: Todo = {
          id: 'todo-1',
          conversationId: 'conv-1',
          subject: 'Test todo',
          status: 'pending',
          claimedBy: null,
          activeForm: null,
          blockedBy: [],
          blocks: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: null,
          metadata: {},
        };
        expect(todo.id).toBeDefined();
        expect(todo.conversationId).toBeDefined();
        expect(todo.subject).toBeDefined();
        expect(todo.status).toBeDefined();
      });
    });
  });

  describe('InMemoryTodoStore', () => {
    let store: InMemoryTodoStore;

    beforeEach(() => {
      store = new InMemoryTodoStore();
    });

    describe('createTodo', () => {
      it('should create a todo', () => {
        const todo = store.createTodo({
          conversationId: 'conv-1',
          subject: 'Test todo',
        });
        expect(todo.id).toBeDefined();
        expect(todo.conversationId).toBe('conv-1');
        expect(todo.subject).toBe('Test todo');
        expect(todo.status).toBe('pending');
        expect(todo.claimedBy).toBeNull();
      });

      it('should generate unique IDs', () => {
        const todo1 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        const todo2 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 2' });
        expect(todo1.id).not.toBe(todo2.id);
      });

      it('should record timestamp', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        expect(todo.createdAt).toBeGreaterThan(0);
        expect(todo.updatedAt).toBeGreaterThan(0);
      });
    });

    describe('getTodo', () => {
      it('should return todo by id', () => {
        const created = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        const retrieved = store.getTodo(created.id);
        expect(retrieved?.id).toBe(created.id);
      });

      it('should return undefined for non-existent todo', () => {
        expect(store.getTodo('non-existent')).toBeUndefined();
      });
    });

    describe('getAllTodos', () => {
      it('should return all todos', () => {
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo 2' });
        expect(store.getAllTodos().length).toBe(2);
      });

      it('should return empty array when no todos', () => {
        expect(store.getAllTodos().length).toBe(0);
      });
    });

    describe('getTodosByConversation', () => {
      it('should filter by conversation', () => {
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        store.createTodo({ conversationId: 'conv-2', subject: 'Todo 2' });
        const todos = store.getTodosByConversation('conv-1');
        expect(todos.length).toBe(1);
        expect(todos[0].conversationId).toBe('conv-1');
      });
    });

    describe('updateTodo', () => {
      it('should update todo status', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        const updated = store.updateTodo({ id: todo.id, status: 'completed' });
        expect(updated?.status).toBe('completed');
        expect(updated?.completedAt).toBeGreaterThan(0);
      });

      it('should update todo subject', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        const updated = store.updateTodo({ id: todo.id, subject: 'Updated Todo' });
        expect(updated?.subject).toBe('Updated Todo');
      });

      it('should return undefined for non-existent todo', () => {
        expect(store.updateTodo({ id: 'non-existent', status: 'completed' })).toBeUndefined();
      });
    });

    describe('deleteTodo', () => {
      it('should delete todo', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        expect(store.deleteTodo(todo.id)).toBe(true);
        expect(store.getTodo(todo.id)).toBeUndefined();
      });

      it('should return false for non-existent todo', () => {
        expect(store.deleteTodo('non-existent')).toBe(false);
      });
    });

    describe('claimTodo', () => {
      it('should claim todo for agent', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        const result = store.claimTodo(todo.id, 'agent-1');
        expect(result.success).toBe(true);
        expect(result.todo?.claimedBy).toBe('agent-1');
        expect(result.todo?.status).toBe('in_progress');
      });

      it('should fail if todo not found', () => {
        const result = store.claimTodo('non-existent', 'agent-1');
        expect(result.success).toBe(false);
      });

      it('should fail if todo not pending', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        store.updateTodo({ id: todo.id, status: 'completed' });
        const result = store.claimTodo(todo.id, 'agent-1');
        expect(result.success).toBe(false);
      });

      it('should fail if agent already busy', () => {
        const todo1 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        const todo2 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 2' });
        store.claimTodo(todo1.id, 'agent-1');
        const result = store.claimTodo(todo2.id, 'agent-1');
        expect(result.success).toBe(false);
      });

      it('should fail if todo already claimed', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        store.claimTodo(todo.id, 'agent-1');
        const result = store.claimTodo(todo.id, 'agent-2');
        expect(result.success).toBe(false);
      });
    });

    describe('getAvailableTodos', () => {
      it('should return pending unclaimed todos', () => {
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo 2' });
        const available = store.getAvailableTodos();
        expect(available.length).toBe(2);
      });

      it('should not return claimed todos', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        store.claimTodo(todo.id, 'agent-1');
        expect(store.getAvailableTodos().length).toBe(0);
      });

      it('should not return completed todos', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        store.updateTodo({ id: todo.id, status: 'completed' });
        expect(store.getAvailableTodos().length).toBe(0);
      });
    });

    describe('getTodosByStatus', () => {
      it('should filter by status', () => {
        const todo1 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo 2' });
        store.updateTodo({ id: todo1.id, status: 'completed' });
        const completed = store.getTodosByStatus('completed');
        expect(completed.length).toBe(1);
        const pending = store.getTodosByStatus('pending');
        expect(pending.length).toBe(1);
      });
    });

    describe('getTodosByAgent', () => {
      it('should filter by agent', () => {
        const todo1 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        const todo2 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 2' });
        store.claimTodo(todo1.id, 'agent-1');
        store.claimTodo(todo2.id, 'agent-2');
        const agent1Todos = store.getTodosByAgent('agent-1');
        expect(agent1Todos.length).toBe(1);
      });
    });

    describe('getAgentStatus', () => {
      it('should return not busy for unclaimed agent', () => {
        const status = store.getAgentStatus('agent-1');
        expect(status.isBusy).toBe(false);
        expect(status.currentTodoId).toBeNull();
      });

      it('should return busy after claim', () => {
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        store.claimTodo(todo.id, 'agent-1');
        const status = store.getAgentStatus('agent-1');
        expect(status.isBusy).toBe(true);
        expect(status.currentTodoId).toBe(todo.id);
      });
    });

    describe('subscribe', () => {
      it('should emit todo:created event', () => {
        const events: TodoEvent[] = [];
        const unsubscribe = store.subscribe((event) => { events.push(event); });
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        expect(events.length).toBe(1);
        expect(events[0].type).toBe('todo:created');
        unsubscribe();
      });

      it('should emit todo:claimed event', () => {
        const events: TodoEvent[] = [];
        const unsubscribe = store.subscribe((event) => { events.push(event); });
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        store.claimTodo(todo.id, 'agent-1');
        expect(events.some((e) => e.type === 'todo:claimed')).toBe(true);
        unsubscribe();
      });

      it('should emit todo:completed event', () => {
        const events: TodoEvent[] = [];
        const unsubscribe = store.subscribe((event) => { events.push(event); });
        const todo = store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        store.updateTodo({ id: todo.id, status: 'completed' });
        expect(events.some((e) => e.type === 'todo:completed')).toBe(true);
        unsubscribe();
      });

      it('should unsubscribe correctly', () => {
        const events: TodoEvent[] = [];
        const unsubscribe = store.subscribe((event) => { events.push(event); });
        unsubscribe();
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo' });
        expect(events.length).toBe(0);
      });
    });

    describe('clearAllTodos', () => {
      it('should clear all todos', () => {
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        store.createTodo({ conversationId: 'conv-1', subject: 'Todo 2' });
        store.clearAllTodos();
        expect(store.getAllTodos().length).toBe(0);
      });
    });

    describe('dependencies', () => {
      it('should create todo with blockedBy', () => {
        const todo1 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        const todo2 = store.createTodo({
          conversationId: 'conv-1',
          subject: 'Todo 2',
          blockedBy: [todo1.id],
        });
        expect(todo2.blockedBy).toContain(todo1.id);
        expect(todo1.blocks).toContain(todo2.id);
      });

      it('should not claim todo with incomplete dependency', () => {
        const todo1 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        const todo2 = store.createTodo({
          conversationId: 'conv-1',
          subject: 'Todo 2',
          blockedBy: [todo1.id],
        });
        const result = store.claimTodo(todo2.id, 'agent-1');
        expect(result.success).toBe(false);
        expect(result.message).toContain('blocked');
      });

      it('should claim todo after dependency completed', () => {
        const todo1 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        const todo2 = store.createTodo({
          conversationId: 'conv-1',
          subject: 'Todo 2',
          blockedBy: [todo1.id],
        });
        store.updateTodo({ id: todo1.id, status: 'completed' });
        const result = store.claimTodo(todo2.id, 'agent-1');
        expect(result.success).toBe(true);
      });

      it('should throw for non-existent blockedBy', () => {
        expect(() => {
          store.createTodo({
            conversationId: 'conv-1',
            subject: 'Todo',
            blockedBy: ['non-existent'],
          });
        }).toThrow();
      });

      it('should get blocking todos', () => {
        const todo1 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        store.createTodo({
          conversationId: 'conv-1',
          subject: 'Todo 2',
          blockedBy: [todo1.id],
        });
        const blocking = store.getBlockingTodos(todo1.id);
        expect(blocking.length).toBe(1);
      });

      it('should get blockedBy todos', () => {
        const todo1 = store.createTodo({ conversationId: 'conv-1', subject: 'Todo 1' });
        const todo2 = store.createTodo({
          conversationId: 'conv-1',
          subject: 'Todo 2',
          blockedBy: [todo1.id],
        });
        const blockedBy = store.getBlockedByTodos(todo2.id);
        expect(blockedBy.length).toBe(1);
      });
    });

    describe('createTodoStore', () => {
      it('should create new store', () => {
        const newStore = createTodoStore();
        expect(newStore).toBeInstanceOf(InMemoryTodoStore);
      });
    });
  });
});