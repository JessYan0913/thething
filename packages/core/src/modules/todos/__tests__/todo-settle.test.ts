import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

import { generateText } from 'ai';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodoWriteToolForConversation } from '../todo-tools/todo-write-tool';
import { createTodoRuntime } from '../todo-runtime';
import {
  settleInProgressTodos,
  findUnsettledInProgress,
  buildSettlePrompt,
} from '../todo-settle';

const CONV = 'conv-settle';

/**
 * 复现场景：主 Agent 一轮正常结束但把最后一个任务留在 in_progress 未落账
 * （"任务完成但面板没更新"的根因）。收尾闸门应检测到并让模型结账。
 */
describe('todo settle gate (段末未收尾 in_progress → 结账)', () => {
  let store: InMemoryTodoStore;
  let execute: (input: unknown) => Promise<any>;
  let todoWrite: any;

  beforeEach(() => {
    store = new InMemoryTodoStore(new HighWaterMarkImpl());
    const runtime = createTodoRuntime({ store, conversationId: CONV });
    todoWrite = createTodoWriteToolForConversation(store, CONV, { scheduler: runtime });
    execute = todoWrite.execute as any;
vi.mocked(generateText).mockReset();
  });

  it('findUnsettledInProgress 只选 in_progress 项', () => {
    store.createTodo({ conversationId: CONV, subject: 'A' }); // pending
    const b = store.createTodo({ conversationId: CONV, subject: 'B' });
    store.updateTodo({ id: b.id, status: 'in_progress' });
    store.createTodo({ conversationId: CONV, subject: 'C' });
    const c = store.getTodosByConversation(CONV).find(t => t.subject === 'C')!;
    store.updateTodo({ id: c.id, status: 'completed' });

    const unsettled = findUnsettledInProgress(store.getTodosByConversation(CONV));
    expect(unsettled.map(t => t.subject)).toEqual(['B']);
  });

  it('buildSettlePrompt 列出全部活跃任务并要求用 todo_write 结账 in_progress 项', () => {
    const b = store.createTodo({ conversationId: CONV, subject: '向用户文字汇报' });
    store.updateTodo({ id: b.id, status: 'in_progress' });
    const prompt = buildSettlePrompt(store.getTodosByConversation(CONV), store);
    expect(prompt).toContain('向用户文字汇报');
    expect(prompt).toContain('[#1]');
    expect(prompt).toContain('todo_write');
    expect(prompt).toContain('completed');
    expect(prompt).toContain('TRUE-REPLACE');
  });

  it('有未收尾 in_progress 时触发结账，模型结账后 store 落库（不复现“面板没更新”）', async () => {
    // 布置：一个 in_progress 任务未落账（本轮实际已完成，只是模型漏标 completed）
    await execute({
      todos: [{ subject: '向用户文字汇报', status: 'in_progress', activeForm: '文字汇报' }],
    });
    const active = store.getTodosByConversation(CONV)[0];

    // 模拟模型收到“结账”提示后，用 todo_write 按编号把该项标 completed + result
    vi.mocked(generateText).mockImplementation(async (args) => {
      const tool = (args as any).tools?.todo_write as any;
      // 结账调用传全量活跃清单（含该项），把该项按 index 置 completed
      await tool.execute({ todos: [{ index: 1, status: 'completed', result: '数字已汇报，验证通过' }] });
      return { text: 'settled' } as never;
    });

    const result = await settleInProgressTodos({
      todoStore: store as never,
      conversationId: CONV,
      model: {} as never,
      todoWriteTool: todoWrite,
    });

    expect(result.triggered).toBe(true);
    expect(result.count).toBe(1);
    // 闸门触发了一次结账调用
    expect(generateText).toHaveBeenCalledTimes(1);
    // store 已被 todo_write 结账 → 不再有 in_progress 幻影
    expect(store.getTodo(active.id)?.status).toBe('completed');
    expect(findUnsettledInProgress(store.getTodosByConversation(CONV))).toHaveLength(0);
  });

  it('没有未收尾 in_progress 时不触发结账（零额外调用）', async () => {
    await execute({
      todos: [{ subject: 'Task A', status: 'completed', result: 'done' }],
    });

    const result = await settleInProgressTodos({
      todoStore: store as never,
      conversationId: CONV,
      model: {} as never,
      todoWriteTool: todoWrite,
    });

    expect(result.triggered).toBe(false);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('结账调用异常不破坏主流程（triggered=false）', async () => {
    await execute({ todos: [{ subject: 'X', status: 'in_progress' }] });
    vi.mocked(generateText).mockRejectedValue(new Error('provider 500'));

    const result = await settleInProgressTodos({
      todoStore: store as never,
      conversationId: CONV,
      model: {} as never,
      todoWriteTool: todoWrite,
    });

    expect(result.triggered).toBe(false);
    // main flow 不抛
  });
});
