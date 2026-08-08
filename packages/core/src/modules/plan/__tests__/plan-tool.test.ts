import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../../todos/store';
import { HighWaterMarkImpl } from '../../todos/high-water-mark';
import { createSubmitPlanTool } from '../plan-tool';
import type { TodoStore } from '../../todos/types';

const CONV = 'conv-1';

describe('submit_plan', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = new InMemoryTodoStore(new HighWaterMarkImpl());
    const tool = createSubmitPlanTool(store, CONV);
    execute = tool.execute! as any;
  });

  it('writes the approved plan into todos with verify', async () => {
    const result = await execute({
      todos: [
        { subject: 'Implement formatTimestamp', verify: 'npx vitest run src/utils passes' },
        { subject: 'Write tests' },
      ],
    });

    expect(result.approved).toBe(true);
    expect(result.created).toBe(2);

    const todos = store.getTodosByConversation(CONV);
    expect(todos).toHaveLength(2);
    const impl = todos.find(t => t.subject === 'Implement formatTimestamp')!;
    expect(impl.status).toBe('pending');
    expect(impl.metadata.verify).toBe('npx vitest run src/utils passes');
  });

  it('replaces the previous active list but keeps completed todos', async () => {
    const first = await execute({ todos: [{ subject: 'Old plan A' }, { subject: 'Old plan B' }] });
    const oldA = store.getTodosByConversation(CONV).find(t => t.subject === 'Old plan A')!;
    const oldB = store.getTodosByConversation(CONV).find(t => t.subject === 'Old plan B')!;

    // 完成 A，然后提交新计划：A(completed) 保留，B(pending) 被替换
    store.updateTodo({ id: oldA.id, status: 'completed' });
    await execute({ todos: [{ subject: 'New plan C' }] });

    const todos = store.getTodosByConversation(CONV);
    expect(todos.some(t => t.id === oldA.id && t.status === 'completed')).toBe(true);
    expect(todos.some(t => t.id === oldB.id)).toBe(false);
    expect(todos.some(t => t.subject === 'New plan C' && t.status === 'pending')).toBe(true);
  });

  it('does not touch todos of other conversations', async () => {
    store.createTodo({ conversationId: 'other-conv', subject: 'Other task' });

    await execute({ todos: [{ subject: 'Mine' }] });

    expect(store.getTodosByConversation('other-conv')).toHaveLength(1);
    expect(store.getTodosByConversation(CONV)).toHaveLength(1);
  });
});
