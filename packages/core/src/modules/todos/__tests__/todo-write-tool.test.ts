import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodoWriteToolForConversation } from '../todo-tools/todo-write-tool';
import type { TodoStore } from '../types';

const CONV = 'conv-1';

describe('todo_write (full-list replace)', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = new InMemoryTodoStore(new HighWaterMarkImpl());
    const tool = createTodoWriteToolForConversation(store, CONV);
    execute = tool.execute! as any;
  });

  it('creates new todos without ids', async () => {
    const result = await execute({
      todos: [
        { subject: 'Task A', status: 'in_progress', activeForm: 'Doing A' },
        { subject: 'Task B', status: 'pending' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.todos).toHaveLength(2);
    const all = store.getTodosByConversation(CONV);
    expect(all).toHaveLength(2);
    expect(all.find(t => t.subject === 'Task A')?.status).toBe('in_progress');
    expect(all.find(t => t.subject === 'Task A')?.activeForm).toBe('Doing A');
    expect(all.find(t => t.subject === 'Task B')?.status).toBe('pending');
  });

  it('updates existing todos by id and removes omitted ones', async () => {
    const first = await execute({
      todos: [
        { subject: 'Task A', status: 'in_progress' },
        { subject: 'Task B', status: 'pending' },
      ],
    });
    const [a, b] = first.todos;

    const second = await execute({
      todos: [
        { id: a.id, subject: 'Task A', status: 'completed' },
        // Task B omitted → removed
        { subject: 'Task C', status: 'in_progress' },
      ],
    });

    expect(second.success).toBe(true);
    const all = store.getTodosByConversation(CONV);
    expect(all).toHaveLength(2);
    expect(store.getTodo(a.id)?.status).toBe('completed');
    expect(store.getTodo(b.id)).toBeUndefined();
    expect(all.find(t => t.subject === 'Task C')?.status).toBe('in_progress');
  });

  it('keeps completed todos when omitted (reconcile exemption)', async () => {
    const first = await execute({
      todos: [
        { subject: 'Task A', status: 'in_progress' },
        { subject: 'Task B', status: 'pending' },
      ],
    });
    const [a, b] = first.todos;
    await execute({ todos: [{ id: a.id, subject: 'Task A', status: 'completed' }] });

    // 省略 A(completed)和 B(pending):completed 保留,active 删除
    await execute({ todos: [{ subject: 'Task C', status: 'in_progress' }] });

    const all = store.getTodosByConversation(CONV);
    expect(store.getTodo(a.id)?.status).toBe('completed');
    expect(store.getTodo(b.id)).toBeUndefined();
    expect(all.some(t => t.subject === 'Task C' && t.status === 'in_progress')).toBe(true);
  });

  it('warns when more than one todo is in_progress', async () => {
    const result = await execute({
      todos: [
        { subject: 'Task A', status: 'in_progress' },
        { subject: 'Task B', status: 'in_progress' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('in_progress');
  });

  it('does not touch todos of other conversations', async () => {
    store.createTodo({ conversationId: 'other-conv', subject: 'Other task' });

    await execute({ todos: [{ subject: 'Mine', status: 'pending' }] });
    await execute({ todos: [] });

    expect(store.getTodosByConversation('other-conv')).toHaveLength(1);
    expect(store.getTodosByConversation(CONV)).toHaveLength(0);
  });

  it('treats unknown ids as new todos', async () => {
    const result = await execute({
      todos: [{ id: 'nonexistent', subject: 'Task X', status: 'pending' }],
    });

    expect(result.success).toBe(true);
    expect(result.todos[0].id).not.toBe('nonexistent');
    expect(store.getTodosByConversation(CONV)).toHaveLength(1);
  });

  it('persists verify on create and result/error on update into metadata', async () => {
    const first = await execute({
      todos: [
        { subject: 'Task A', status: 'in_progress', verify: 'npx vitest run passes' },
        { subject: 'Task B', status: 'pending' },
      ],
    });
    const [a, b] = first.todos;
    expect(store.getTodo(a.id)?.metadata.verify).toBe('npx vitest run passes');

    await execute({
      todos: [
        { id: a.id, subject: 'Task A', status: 'completed', result: 'All 12 tests green' },
        { id: b.id, subject: 'Task B', status: 'failed', error: 'Missing fixture file' },
      ],
    });

    const aFinal = store.getTodo(a.id)!;
    expect(aFinal.metadata.result).toBe('All 12 tests green');
    // metadata 合并语义:更新 result 不应丢掉创建时的 verify
    expect(aFinal.metadata.verify).toBe('npx vitest run passes');
    expect(store.getTodo(b.id)?.metadata.error).toBe('Missing fixture file');
  });

  it('warns when completed without result or failed without error', async () => {
    const result = await execute({
      todos: [
        { subject: 'Task A', status: 'completed' },
        { subject: 'Task B', status: 'failed' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('completed without a result');
    expect(result.message).toContain('failed without an error');
  });

  it('does not warn when completed/failed carry result/error', async () => {
    const result = await execute({
      todos: [
        { subject: 'Task A', status: 'completed', result: 'done and verified' },
        { subject: 'Task B', status: 'failed', error: 'timeout' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.message).toBeUndefined();
  });
});
