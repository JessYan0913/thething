import { describe, it, expect, beforeEach } from 'vitest';
import type { Task, TaskStatus, TaskEvent } from '../types';
import { InMemoryTaskStore, createTaskStore } from '../store';

// ============================================================
// Tasks Module Tests
// ============================================================
describe('tasks', () => {
  describe('types', () => {
    describe('TaskStatus', () => {
      it('should have valid status values', () => {
        const statuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'];
        expect(statuses.length).toBe(5);
      });
    });

    describe('Task interface', () => {
      it('should have required fields', () => {
        const task: Task = {
          id: 'task-1',
          conversationId: 'conv-1',
          subject: 'Test task',
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
        expect(task.id).toBeDefined();
        expect(task.conversationId).toBeDefined();
        expect(task.subject).toBeDefined();
        expect(task.status).toBeDefined();
      });
    });
  });

  describe('InMemoryTaskStore', () => {
    let store: InMemoryTaskStore;

    beforeEach(() => {
      store = new InMemoryTaskStore();
    });

    describe('createTask', () => {
      it('should create a task', () => {
        const task = store.createTask({
          conversationId: 'conv-1',
          subject: 'Test task',
        });
        expect(task.id).toBeDefined();
        expect(task.conversationId).toBe('conv-1');
        expect(task.subject).toBe('Test task');
        expect(task.status).toBe('pending');
        expect(task.claimedBy).toBeNull();
      });

      it('should generate unique IDs', () => {
        const task1 = store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        const task2 = store.createTask({ conversationId: 'conv-1', subject: 'Task 2' });
        expect(task1.id).not.toBe(task2.id);
      });

      it('should record timestamp', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        expect(task.createdAt).toBeGreaterThan(0);
        expect(task.updatedAt).toBeGreaterThan(0);
      });
    });

    describe('getTask', () => {
      it('should return task by id', () => {
        const created = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        const retrieved = store.getTask(created.id);
        expect(retrieved?.id).toBe(created.id);
      });

      it('should return undefined for non-existent task', () => {
        expect(store.getTask('non-existent')).toBeUndefined();
      });
    });

    describe('getAllTasks', () => {
      it('should return all tasks', () => {
        store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        store.createTask({ conversationId: 'conv-1', subject: 'Task 2' });
        expect(store.getAllTasks().length).toBe(2);
      });

      it('should return empty array when no tasks', () => {
        expect(store.getAllTasks().length).toBe(0);
      });
    });

    describe('getTasksByConversation', () => {
      it('should filter by conversation', () => {
        store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        store.createTask({ conversationId: 'conv-2', subject: 'Task 2' });
        const tasks = store.getTasksByConversation('conv-1');
        expect(tasks.length).toBe(1);
        expect(tasks[0].conversationId).toBe('conv-1');
      });
    });

    describe('updateTask', () => {
      it('should update task status', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        const updated = store.updateTask({ id: task.id, status: 'completed' });
        expect(updated?.status).toBe('completed');
        expect(updated?.completedAt).toBeGreaterThan(0);
      });

      it('should update task subject', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        const updated = store.updateTask({ id: task.id, subject: 'Updated Task' });
        expect(updated?.subject).toBe('Updated Task');
      });

      it('should return undefined for non-existent task', () => {
        expect(store.updateTask({ id: 'non-existent', status: 'completed' })).toBeUndefined();
      });
    });

    describe('deleteTask', () => {
      it('should delete task', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        expect(store.deleteTask(task.id)).toBe(true);
        expect(store.getTask(task.id)).toBeUndefined();
      });

      it('should return false for non-existent task', () => {
        expect(store.deleteTask('non-existent')).toBe(false);
      });
    });

    describe('claimTask', () => {
      it('should claim task for agent', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        const result = store.claimTask(task.id, 'agent-1');
        expect(result.success).toBe(true);
        expect(result.task?.claimedBy).toBe('agent-1');
        expect(result.task?.status).toBe('in_progress');
      });

      it('should fail if task not found', () => {
        const result = store.claimTask('non-existent', 'agent-1');
        expect(result.success).toBe(false);
      });

      it('should fail if task not pending', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        store.updateTask({ id: task.id, status: 'completed' });
        const result = store.claimTask(task.id, 'agent-1');
        expect(result.success).toBe(false);
      });

      it('should fail if agent already busy', () => {
        const task1 = store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        const task2 = store.createTask({ conversationId: 'conv-1', subject: 'Task 2' });
        store.claimTask(task1.id, 'agent-1');
        const result = store.claimTask(task2.id, 'agent-1');
        expect(result.success).toBe(false);
      });

      it('should fail if task already claimed', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        store.claimTask(task.id, 'agent-1');
        const result = store.claimTask(task.id, 'agent-2');
        expect(result.success).toBe(false);
      });
    });

    describe('getAvailableTasks', () => {
      it('should return pending unclaimed tasks', () => {
        store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        store.createTask({ conversationId: 'conv-1', subject: 'Task 2' });
        const available = store.getAvailableTasks();
        expect(available.length).toBe(2);
      });

      it('should not return claimed tasks', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        store.claimTask(task.id, 'agent-1');
        expect(store.getAvailableTasks().length).toBe(0);
      });

      it('should not return completed tasks', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        store.updateTask({ id: task.id, status: 'completed' });
        expect(store.getAvailableTasks().length).toBe(0);
      });
    });

    describe('getTasksByStatus', () => {
      it('should filter by status', () => {
        const task1 = store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        store.createTask({ conversationId: 'conv-1', subject: 'Task 2' });
        store.updateTask({ id: task1.id, status: 'completed' });
        const completed = store.getTasksByStatus('completed');
        expect(completed.length).toBe(1);
        const pending = store.getTasksByStatus('pending');
        expect(pending.length).toBe(1);
      });
    });

    describe('getTasksByAgent', () => {
      it('should filter by agent', () => {
        const task1 = store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        const task2 = store.createTask({ conversationId: 'conv-1', subject: 'Task 2' });
        store.claimTask(task1.id, 'agent-1');
        store.claimTask(task2.id, 'agent-2');
        const agent1Tasks = store.getTasksByAgent('agent-1');
        expect(agent1Tasks.length).toBe(1);
      });
    });

    describe('getAgentStatus', () => {
      it('should return not busy for unclaimed agent', () => {
        const status = store.getAgentStatus('agent-1');
        expect(status.isBusy).toBe(false);
        expect(status.currentTaskId).toBeNull();
      });

      it('should return busy after claim', () => {
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        store.claimTask(task.id, 'agent-1');
        const status = store.getAgentStatus('agent-1');
        expect(status.isBusy).toBe(true);
        expect(status.currentTaskId).toBe(task.id);
      });
    });

    describe('subscribe', () => {
      it('should emit task:created event', () => {
        const events: TaskEvent[] = [];
        const unsubscribe = store.subscribe((event) => { events.push(event); });
        store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        expect(events.length).toBe(1);
        expect(events[0].type).toBe('task:created');
        unsubscribe();
      });

      it('should emit task:claimed event', () => {
        const events: TaskEvent[] = [];
        const unsubscribe = store.subscribe((event) => { events.push(event); });
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        store.claimTask(task.id, 'agent-1');
        expect(events.some((e) => e.type === 'task:claimed')).toBe(true);
        unsubscribe();
      });

      it('should emit task:completed event', () => {
        const events: TaskEvent[] = [];
        const unsubscribe = store.subscribe((event) => { events.push(event); });
        const task = store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        store.updateTask({ id: task.id, status: 'completed' });
        expect(events.some((e) => e.type === 'task:completed')).toBe(true);
        unsubscribe();
      });

      it('should unsubscribe correctly', () => {
        const events: TaskEvent[] = [];
        const unsubscribe = store.subscribe((event) => { events.push(event); });
        unsubscribe();
        store.createTask({ conversationId: 'conv-1', subject: 'Task' });
        expect(events.length).toBe(0);
      });
    });

    describe('clearAllTasks', () => {
      it('should clear all tasks', () => {
        store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        store.createTask({ conversationId: 'conv-1', subject: 'Task 2' });
        store.clearAllTasks();
        expect(store.getAllTasks().length).toBe(0);
      });
    });

    describe('dependencies', () => {
      it('should create task with blockedBy', () => {
        const task1 = store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        const task2 = store.createTask({
          conversationId: 'conv-1',
          subject: 'Task 2',
          blockedBy: [task1.id],
        });
        expect(task2.blockedBy).toContain(task1.id);
        expect(task1.blocks).toContain(task2.id);
      });

      it('should not claim task with incomplete dependency', () => {
        const task1 = store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        const task2 = store.createTask({
          conversationId: 'conv-1',
          subject: 'Task 2',
          blockedBy: [task1.id],
        });
        const result = store.claimTask(task2.id, 'agent-1');
        expect(result.success).toBe(false);
        expect(result.message).toContain('blocked');
      });

      it('should claim task after dependency completed', () => {
        const task1 = store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        const task2 = store.createTask({
          conversationId: 'conv-1',
          subject: 'Task 2',
          blockedBy: [task1.id],
        });
        store.updateTask({ id: task1.id, status: 'completed' });
        const result = store.claimTask(task2.id, 'agent-1');
        expect(result.success).toBe(true);
      });

      it('should throw for non-existent blockedBy', () => {
        expect(() => {
          store.createTask({
            conversationId: 'conv-1',
            subject: 'Task',
            blockedBy: ['non-existent'],
          });
        }).toThrow();
      });

      it('should get blocking tasks', () => {
        const task1 = store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        store.createTask({
          conversationId: 'conv-1',
          subject: 'Task 2',
          blockedBy: [task1.id],
        });
        const blocking = store.getBlockingTasks(task1.id);
        expect(blocking.length).toBe(1);
      });

      it('should get blockedBy tasks', () => {
        const task1 = store.createTask({ conversationId: 'conv-1', subject: 'Task 1' });
        const task2 = store.createTask({
          conversationId: 'conv-1',
          subject: 'Task 2',
          blockedBy: [task1.id],
        });
        const blockedBy = store.getBlockedByTasks(task2.id);
        expect(blockedBy.length).toBe(1);
      });
    });

    describe('createTaskStore', () => {
      it('should create new store', () => {
        const newStore = createTaskStore();
        expect(newStore).toBeInstanceOf(InMemoryTaskStore);
      });
    });
  });
});