import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodoWriteToolForConversation, todoWriteToolSchema } from '../todo-tools/todo-write-tool';
import type { TodoStore } from '../types';

const CONV = 'conv-1';

describe('todo_write (upsert; omitted kept, explicit cancel)', () => {
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

  it('updates existing todos by id and keeps omitted ones (no silent delete)', async () => {
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
        // Task B omitted → kept（不再被静默删除）
        { subject: 'Task C', status: 'in_progress' },
      ],
    });

    expect(second.success).toBe(true);
    const all = store.getTodosByConversation(CONV);
    expect(all).toHaveLength(3);
    expect(store.getTodo(a.id)?.status).toBe('completed');
    expect(store.getTodo(b.id)?.status).toBe('pending'); // 保留
    expect(all.find(t => t.subject === 'Task C')?.status).toBe('in_progress');
  });

  it('keeps omitted todos (completed and active) — explicit cancelled is the only way to drop', async () => {
    const first = await execute({
      todos: [
        { subject: 'Task A', status: 'in_progress' },
        { subject: 'Task B', status: 'pending' },
      ],
    });
    const [a, b] = first.todos;
    await execute({ todos: [{ id: a.id, subject: 'Task A', status: 'completed' }] });

    // 省略 A(completed) 和 B(pending)：两者都保留
    await execute({ todos: [{ subject: 'Task C', status: 'in_progress' }] });

    const all = store.getTodosByConversation(CONV);
    expect(store.getTodo(a.id)?.status).toBe('completed');
    expect(store.getTodo(b.id)?.status).toBe('pending'); // 保留
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
    expect(store.getTodosByConversation(CONV)).toHaveLength(1); // 空列表不再清空（不静默删）
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

    // 单完成约束：一次只标记一个 completed/failed，分两次调用
    await execute({
      todos: [{ id: a.id, subject: 'Task A', status: 'completed', result: 'All 12 tests green' }],
    });
    await execute({
      todos: [{ id: b.id, subject: 'Task B', status: 'failed', error: 'Missing fixture file' }],
    });

    const aFinal = store.getTodo(a.id)!;
    expect(aFinal.metadata.result).toBe('All 12 tests green');
    // metadata 合并语义:更新 result 不应丢掉创建时的 verify
    expect(aFinal.metadata.verify).toBe('npx vitest run passes');
    expect(store.getTodo(b.id)?.metadata.error).toBe('Missing fixture file');
  });

  it('warns when completed without result', async () => {
    const result = await execute({
      todos: [{ subject: 'Task A', status: 'completed' }],
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('completed without a result');
  });

  it('warns when failed without error', async () => {
    const result = await execute({
      todos: [{ subject: 'Task B', status: 'failed' }],
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('failed without an error');
  });

  it('does not warn when completed carries result', async () => {
    const result = await execute({
      todos: [{ subject: 'Task A', status: 'completed', result: 'done and verified' }],
    });

    expect(result.success).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('does not warn when failed carries error', async () => {
    const result = await execute({
      todos: [{ subject: 'Task B', status: 'failed', error: 'timeout' }],
    });

    expect(result.success).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('rejects marking multiple todos completed/failed in one call', async () => {
    const first = await execute({
      todos: [
        { subject: 'Task A', status: 'in_progress' },
        { subject: 'Task B', status: 'in_progress' },
      ],
    });
    const [a, b] = first.todos;

    const result = await execute({
      todos: [
        { id: a.id, subject: 'Task A', status: 'completed', result: 'done' },
        { id: b.id, subject: 'Task B', status: 'completed', result: 'done too' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('一次只能将一个');
  });
});

describe('todo_write continuation dedup (id-less title maps to existing active item)', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = new InMemoryTodoStore(new HighWaterMarkImpl());
    const tool = createTodoWriteToolForConversation(store, CONV);
    execute = tool.execute! as any;
  });

  it('maps an id-less title to the existing active item (no new row)', async () => {
    const first = await execute({
      todos: [
        { subject: 'Task A', status: 'in_progress', activeForm: 'Doing A' },
        { subject: 'Task B', status: 'pending' },
      ],
    });
    const [a] = first.todos;

    // 续做：无 id 重提同标题 → 应映射回 a.id，不新增行
    const second = await execute({
      todos: [{ subject: 'Task A', status: 'in_progress', activeForm: 'Still doing A' }],
    });

    expect(second.success).toBe(true);
    expect(second.todos[0].id).toBe(a.id);
    const all = store.getTodosByConversation(CONV);
    expect(all).toHaveLength(2); // 未新增第三行
    expect(store.getTodo(a.id)?.activeForm).toBe('Still doing A');
  });

  it('normalizes surrounding/duplicate whitespace before matching', async () => {
    const first = await execute({ todos: [{ subject: '调研 write 工具的实现', status: 'in_progress' }] });
    const id = first.todos[0].id;

    const second = await execute({
      todos: [{ subject: '  调研  write 工具的实现  ', status: 'in_progress' }],
    });

    expect(second.todos[0].id).toBe(id);
    expect(store.getTodosByConversation(CONV)).toHaveLength(1);
  });

  it('creates a new row when title has no active match in the list', async () => {
    await execute({ todos: [{ subject: 'Task A', status: 'completed', result: 'done' }] });
    // Task A 已完成 → 不参与映射；Task B 是全新
    const result = await execute({ todos: [{ subject: 'Task B', status: 'pending' }] });

    expect(result.success).toBe(true);
    expect(store.getTodosByConversation(CONV)).toHaveLength(2);
  });

  it('maps id-less title but treats completed/failed explicitly by id', async () => {
    await execute({
      todos: [{ subject: 'Task A', status: 'in_progress' }],
    });
    // 无 id 命中进行中任务 → 直接标 completed 也应映射到原 id
    const result = await execute({
      todos: [{ subject: 'Task A', status: 'completed', result: 'verified' }],
    });
    const all = store.getTodosByConversation(CONV);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('completed');
    expect(all[0].metadata.result).toBe('verified');
  });

  it('create:true forces a new row even when the title matches an active item', async () => {
    const first = await execute({ todos: [{ subject: 'Task A', status: 'in_progress' }] });
    const a = first.todos[0];

    const result = await execute({
      todos: [{ subject: 'Task A', status: 'in_progress', create: true }],
    });

    expect(result.success).toBe(true);
    expect(result.todos[0].id).not.toBe(a.id);
    expect(store.getTodosByConversation(CONV)).toHaveLength(2);
  });

  it('maps id-less title with exact id semantics but honors an explicit stale id to update', async () => {
    const first = await execute({ todos: [{ subject: 'Task A', status: 'in_progress' }] });
    const a = first.todos[0];

    // 带真实 id → 更新（原行为），不新增
    const result = await execute({
      todos: [{ id: a.id, subject: 'Task A', status: 'pending' }],
    });
    expect(result.todos[0].id).toBe(a.id);
    expect(store.getTodosByConversation(CONV)).toHaveLength(1);
  });

  it('mapping does not cross conversations', async () => {
    store.createTodo({ conversationId: 'other-conv', subject: 'Task A' });

    await execute({ todos: [{ subject: 'Task A', status: 'in_progress' }] });
    // 本会话 Task A 是新建（other-conv 不参与映射）
    expect(store.getTodosByConversation(CONV)).toHaveLength(1);
    expect(store.getTodosByConversation('other-conv')).toHaveLength(1);
  });
});

describe('todo_write id-only update (subject optional, carries existing title forward)', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = new InMemoryTodoStore(new HighWaterMarkImpl());
    const tool = createTodoWriteToolForConversation(store, CONV);
    execute = tool.execute! as any;
  });

  it('schema accepts id + status without subject (the shape that previously failed)', () => {
    const parsed = todoWriteToolSchema.safeParse({
      todos: [{ id: 'todo-1', status: 'completed', result: 'done' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('schema rejects creating a new todo without subject', () => {
    const parsed = todoWriteToolSchema.safeParse({
      todos: [{ status: 'completed', result: 'done' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('execute completes an existing todo by id only, keeping its original subject', async () => {
    const created = await execute({ todos: [{ subject: 'Task A', status: 'in_progress' }] });
    const a = created.todos[0];

    // 只传 id + status + result（不传 subject）→ 应成功，标题沿用既有值
    const result = await execute({
      todos: [{ id: a.id, status: 'completed', result: 'all verified' }],
    });

    expect(result.success).toBe(true);
    expect(result.todos[0]).toMatchObject({ id: a.id, subject: 'Task A', status: 'completed' });
    expect(store.getTodosByConversation(CONV)).toHaveLength(1); // 没有新增重复行
  });
});
