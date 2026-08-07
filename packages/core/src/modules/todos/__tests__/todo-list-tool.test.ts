import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodoListToolForConversation } from '../todo-tools/todo-list-tool';
import type { TodoStore } from '../types';

const CONV = 'conv-1';

describe('todo_list (snapshot + single detail merged)', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = new InMemoryTodoStore(new HighWaterMarkImpl());
    const tool = createTodoListToolForConversation(store, CONV);
    execute = tool.execute! as any;
    store.createTodo({ conversationId: CONV, subject: 'Task A', metadata: { priority: 'high' } });
    store.createTodo({ conversationId: CONV, subject: 'Task B' });
  });

  it('without id returns a compact snapshot (no metadata)', async () => {
    const result = await execute({});

    expect(result.success).toBe(true);
    expect(result.todos).toHaveLength(2);
    expect(result.todos[0]).not.toHaveProperty('metadata');
    expect(result.total).toBe(2);
    expect(result.snapshot).toContain('Task A');
  });

  it('with id returns full details including metadata', async () => {
    const todo = store.getTodosByConversation(CONV)[0];

    const result = await execute({ id: todo.id });

    expect(result.success).toBe(true);
    expect(result.todo.id).toBe(todo.id);
    expect(result.todo.subject).toBe('Task A');
    expect(result.todo.metadata?.priority).toBe('high');
    expect(result.todo.createdAt).toBeTypeOf('number');
  });

  it('with unknown id returns an error', async () => {
    const result = await execute({ id: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('supports status filter in snapshot mode', async () => {
    const result = await execute({ status: 'pending' });

    expect(result.success).toBe(true);
    expect(result.todos).toHaveLength(2);
  });
});
