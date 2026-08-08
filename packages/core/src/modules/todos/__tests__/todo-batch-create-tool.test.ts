import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodoBatchCreateToolForConversation } from '../todo-tools/todo-batch-create-tool';
import type { TodoStore } from '../types';

const CONV = 'conv-1';

describe('todo_create_batch', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = new InMemoryTodoStore(new HighWaterMarkImpl());
    const tool = createTodoBatchCreateToolForConversation(store, CONV);
    execute = tool.execute! as any;
  });

  it('creates todos with dependencies resolved from 1-based step indices', async () => {
    const result = await execute({
      tasks: [
        { subject: 'Read requirements' },
        { subject: 'Implement', dependsOnSteps: [1] },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
    const impl = store.getTodo(result.created[1].id)!;
    expect(impl.blockedBy).toEqual([result.created[0].id]);
  });

  it('rejects forward references', async () => {
    const result = await execute({
      tasks: [
        { subject: 'A', dependsOnSteps: [2] },
        { subject: 'B' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('forward reference');
  });

  it('persists verify into metadata', async () => {
    const result = await execute({
      tasks: [
        { subject: 'Implement endpoint', verify: 'curl /export returns 200' },
        { subject: 'No verify task' },
      ],
    });

    expect(result.success).toBe(true);
    expect(store.getTodo(result.created[0].id)?.metadata.verify).toBe('curl /export returns 200');
    expect(store.getTodo(result.created[1].id)?.metadata.verify).toBeUndefined();
  });
});
