import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { createTodoToolForConversation, repairTodoRawInput, todoToolSchema } from '../todo-tools/todo-tool';
import { createTodoRuntime } from '../todo-runtime';
import type { TodoStore } from '../types';

const CONV = 'conv-1';

describe('todo 单工具（action: list/add/update/delete/clear）', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = new InMemoryTodoStore();
    const runtime = createTodoRuntime({ store, conversationId: CONV });
    const tool = createTodoToolForConversation(store, CONV, { scheduler: runtime });
    execute = tool.execute! as any;
  });

  // ---- add ----

  it('add 批量新建（status/activeForm）', async () => {
    const result = await execute({
      action: 'add',
      items: [
        { subject: 'Task A', status: 'in_progress', activeForm: 'Doing A' },
        { subject: 'Task B' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(2);
    const all = store.getTodosByConversation(CONV);
    expect(all).toHaveLength(2);
    expect(all.find(t => t.subject === 'Task A')?.status).toBe('in_progress');
    expect(all.find(t => t.subject === 'Task A')?.activeForm).toBe('Doing A');
    expect(all.find(t => t.subject === 'Task B')?.status).toBe('pending');
    // 编号创建时物化：1、2
    expect(all[0].number).toBe(1);
    expect(all[1].number).toBe(2);
  });

  it('schema rejects add without subject', () => {
    expect(todoToolSchema.safeParse({ action: 'add', items: [{ status: 'in_progress' }] }).success).toBe(false);
  });

  it('add 依赖提示 dependsOnSteps 映射为 blockedBy', async () => {
    const result = await execute({
      action: 'add',
      items: [
        { subject: 'Read requirements' },
        { subject: 'Implement', dependsOnSteps: [1] },
      ],
    });

    expect(result.success).toBe(true);
    const all = store.getTodosByConversation(CONV);
    expect(all[1].blockedBy).toEqual([all[0].id]);
  });

  it('add 拒绝 forward reference 依赖', async () => {
    const result = await execute({
      action: 'add',
      items: [
        { subject: 'A', dependsOnSteps: [2] },
        { subject: 'B' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('forward reference');
    expect(store.getTodosByConversation(CONV)).toHaveLength(0);
  });

  it('add 新建即完成：经 internal claim→complete 链落账', async () => {
    const result = await execute({
      action: 'add',
      items: [{ subject: 'T', status: 'completed', result: 'done and verified' }],
    });

    expect(result.success).toBe(true);
    const t = store.getTodosByConversation(CONV).find(x => x.subject === 'T')!;
    expect(t.status).toBe('completed');
    expect(t.metadata?.result).toBe('done and verified');
  });

  // ---- update（#N 引用）----

  it('update by #N 完成并写 result，标题沿旧', async () => {
    await execute({ action: 'add', items: [{ subject: 'Task A', status: 'in_progress' }] });
    const id = store.getTodosByConversation(CONV)[0].id;

    const result = await execute({ action: 'update', id: '#1', status: 'completed', result: 'done and verified' });

    expect(result.success).toBe(true);
    const after = store.getTodo(id)!;
    expect(after.status).toBe('completed');
    expect(after.subject).toBe('Task A');
    expect(after.metadata?.result).toBe('done and verified');
  });

  it('update by #N 保留未提及的 metadata（verify 不丢）', async () => {
    await execute({ action: 'add', items: [{ subject: 'Task A', status: 'in_progress', verify: 'npx vitest passes' }] });
    const id = store.getTodosByConversation(CONV)[0].id;

    await execute({ action: 'update', id: '#1', status: 'completed', result: 'green' });

    const after = store.getTodo(id)!;
    expect(after.metadata?.verify).toBe('npx vitest passes');
    expect(after.metadata?.result).toBe('green');
  });

  it('update 可改 subject / activeForm / 清 activeForm', async () => {
    await execute({ action: 'add', items: [{ subject: 'A', status: 'in_progress', activeForm: 'Doing' }] });
    const id = store.getTodosByConversation(CONV)[0].id;

    await execute({ action: 'update', id: '#1', subject: 'A2', activeForm: null });

    const after = store.getTodo(id)!;
    expect(after.subject).toBe('A2');
    expect(after.activeForm).toBeNull();
  });

  it('update 无匹配 #N 报错，不静默新建', async () => {
    await execute({ action: 'add', items: [{ subject: 'Task A' }] });
    const before = store.getTodosByConversation(CONV).length;

    const result = await execute({ action: 'update', id: '#7', status: 'completed' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/#7/);
    expect(store.getTodosByConversation(CONV)).toHaveLength(before);
  });

  it('update 引用已收尾编号给出终态提示（T5）', async () => {
    await execute({ action: 'add', items: [{ subject: 'Task A' }] });
    await execute({ action: 'update', id: '#1', status: 'completed', result: 'done' });

    const result = await execute({ action: 'update', id: '#1', status: 'in_progress' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already completed');
    const t = store.getTodosByConversation(CONV).find(x => x.subject === 'Task A')!;
    expect(t.status).toBe('completed'); // 未误重开
  });

  it('update no-op 重发 in_progress 不报错、不涨事件', async () => {
    await execute({ action: 'add', items: [{ subject: 'A', status: 'in_progress' }] });
    const before = store.getRevision();

    const result = await execute({ action: 'update', id: '#1', status: 'in_progress' });

    expect(result.success).toBe(true);
    // 同状态 no-op：不触发额外迁移事件（编号事件 1 次 add + 1 次 claim，status 重发无新事件）
    expect(store.getRevision()).toBe(before);
    expect(store.getTodosByStatus('in_progress')).toHaveLength(1);
  });

  it('update failed→pending 重开（retry 语义）', async () => {
    await execute({ action: 'add', items: [{ subject: 'A', status: 'failed', error: 'boom' }] });
    expect(store.getTodosByConversation(CONV)[0].status).toBe('failed');

    const result = await execute({ action: 'update', id: '#1', status: 'pending' });

    expect(result.success).toBe(true);
    const t = store.getTodosByConversation(CONV)[0];
    expect(t.status).toBe('pending');
    expect(t.metadata?.error).toBeUndefined();
  });

  // ---- patch 语义 ----

  it('patch: 未列出的活跃项原样保留（无自动取消）', async () => {
    await execute({ action: 'add', items: [{ subject: 'A' }, { subject: 'B' }, { subject: 'C' }] });

    // 只更新 #1 + 新增 D；#2、#3 未提及 → 保留
    await execute({ action: 'update', id: '#1', status: 'in_progress' });
    await execute({ action: 'add', items: [{ subject: 'D' }] });

    const all = store.getTodosByConversation(CONV);
    expect(all.find(t => t.subject === 'A')?.status).toBe('in_progress');
    expect(all.find(t => t.subject === 'B')?.status).toBe('pending');
    expect(all.find(t => t.subject === 'C')?.status).toBe('pending');
    expect(all.find(t => t.subject === 'D')?.status).toBe('pending');
  });

  // ---- delete / clear ----

  it('delete 软取消指定 #N（编号不复用）', async () => {
    await execute({ action: 'add', items: [{ subject: 'A' }, { subject: 'B' }] });

    const result = await execute({ action: 'delete', id: '#1' });

    expect(result.success).toBe(true);
    const all = store.getTodosByConversation(CONV);
    expect(all.find(t => t.subject === 'A')?.status).toBe('cancelled');
    expect(all.find(t => t.subject === 'B')?.status).toBe('pending');
    // 编号占用保留：再新建 → #3，不复用 #1
    await execute({ action: 'add', items: [{ subject: 'C' }] });
    const c = store.getTodosByConversation(CONV).find(t => t.subject === 'C')!;
    expect(c.number).toBe(3);
  });

  it('delete 引用已收尾编号 → 提示', async () => {
    await execute({ action: 'add', items: [{ subject: 'A' }] });
    await execute({ action: 'update', id: '#1', status: 'completed', result: 'ok' });

    const result = await execute({ action: 'delete', id: '#1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already completed');
  });

  it('clear 取消全部活跃任务（终态历史保留）', async () => {
    await execute({ action: 'add', items: [{ subject: 'A' }, { subject: 'B' }] });
    await execute({ action: 'update', id: '#1', status: 'completed', result: 'ok' });

    const result = await execute({ action: 'clear' });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(1); // 只有 #2 活跃被取消
    const all = store.getTodosByConversation(CONV);
    expect(all.find(t => t.subject === 'A')?.status).toBe('completed');
    expect(all.find(t => t.subject === 'B')?.status).toBe('cancelled');
  });

  // ---- list ----

  it('list 默认紧凑视图：活跃 + 最近 done（含 #N）', async () => {
    await execute({ action: 'add', items: [{ subject: '调研X' }, { subject: '写X' }] });

    const result = await execute({ action: 'list' });

    expect(result.success).toBe(true);
    expect(result.todos).toContainEqual(expect.objectContaining({ id: 1, subject: '调研X', status: 'pending' }));
    expect(result.todos).toContainEqual(expect.objectContaining({ id: 2, subject: '写X', status: 'pending' }));
    expect(result.snapshot).toMatch(/\[#1\]/);
    expect(result.snapshot).toMatch(/\[#2\]/);
    expect(result.snapshot).not.toContain('todo-'); // 无内部 id
  });

  it('list scope:all 返回终态行，默认不含', async () => {
    await execute({ action: 'add', items: [{ subject: 'A' }] });
    await execute({ action: 'update', id: '#1', status: 'completed', result: 'ok' });

    const compact = await execute({ action: 'list' });
    expect(compact.todos).toHaveLength(0); // 活跃视图无

    const all = await execute({ action: 'list', scope: 'all' });
    expect(all.todos).toHaveLength(1);
    expect(all.todos[0].status).toBe('completed');
  });

  it('list id:#N 返回单条完整详情（含 verify/result）', async () => {
    await execute({ action: 'add', items: [{ subject: 'A', verify: 'vitest 通过' }] });

    const result = await execute({ action: 'list', id: '#1' });

    expect(result.success).toBe(true);
    expect(result.todos[0].verify).toBe('vitest 通过');
  });

  // ---- lint（只提示不阻断）----

  it('warns（不阻断）当多个 in_progress', async () => {
    const result = await execute({
      action: 'add',
      items: [{ subject: 'A', status: 'in_progress' }, { subject: 'B', status: 'in_progress' }],
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.join(' ')).toMatch(/exactly one/);
  });

  it('warns（不阻断）新建标题命中活跃清单 #N', async () => {
    await execute({ action: 'add', items: [{ subject: '调研X' }] });

    const result = await execute({ action: 'add', items: [{ subject: '调研X' }] });

    expect(result.success).toBe(true);
    expect(result.warnings!.join(' ')).toContain('#1');
    expect(store.getTodosByConversation(CONV)).toHaveLength(2); // 行照建，只提示
  });

  it('warns 同一调用内重复标题', async () => {
    const result = await execute({ action: 'add', items: [{ subject: 'A' }, { subject: 'A' }] });
    expect(result.success).toBe(true);
    expect(result.warnings!.join(' ')).toContain('created more than once');
  });

  it('warns 完成缺 result / 失败缺 error', async () => {
    const done = await execute({ action: 'add', items: [{ subject: 'A', status: 'completed' }] });
    expect(done.warnings!.join(' ')).toContain('completed without a result');

    const failed = await execute({ action: 'add', items: [{ subject: 'B', status: 'failed' }] });
    expect(failed.warnings!.join(' ')).toContain('failed without an error');
  });

  it('不 warn 当终态带 result/error，或标题只存在于已完成', async () => {
    const ok = await execute({ action: 'add', items: [{ subject: 'A', status: 'completed', result: 'done' }] });
    expect(ok.warnings).toBeUndefined();
    const ok2 = await execute({ action: 'add', items: [{ subject: 'B', status: 'failed', error: 'boom' }] });
    expect(ok2.warnings).toBeUndefined();

    const done = await execute({ action: 'add', items: [{ subject: '调研X' }] });
    await execute({ action: 'update', id: '#3', status: 'completed', result: 'done' });
    // 终态历史不参与活跃 → 重新调研不判重复
    const again = await execute({ action: 'add', items: [{ subject: '调研X' }] });
    expect(again.warnings).toBeUndefined();
  });

  it('warns（T5 lint）一次 add 标多个完成', async () => {
    const result = await execute({
      action: 'add',
      items: [
        { subject: 'A', status: 'completed', result: 'r1' },
        { subject: 'B', status: 'completed', result: 'r2' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.warnings!.join(' ')).toMatch(/completed\/failed in one call/);
  });

  // ---- 会话隔离 ----

  it('不触碰其他会话的 todo', async () => {
    store.createTodo({ conversationId: 'other-conv', subject: 'Other task' });
    await execute({ action: 'add', items: [{ subject: 'Mine' }] });

    expect(store.getTodosByConversation('other-conv')).toHaveLength(1);
  });
});

describe('repairTodoRawInput（模型把 items 数组序列化成字符串）', () => {
  it('把 items 字符串 parse 回数组', () => {
    const raw = JSON.stringify({
      action: 'add',
      items: '[{"subject":"分析布局缺点","status":"in_progress"},{"subject":"提出方案","status":"pending"}]',
    });
    const repaired = repairTodoRawInput(raw);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!) as { action: string; items: unknown[] };
    expect(parsed.action).toBe('add');
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items).toHaveLength(2);
  });

  it('items 字符串被截断时也能补全', () => {
    const raw = JSON.stringify({
      action: 'add',
      items: '[{"subject":"a","status":"in_progress"},{"subject":"b","status":"pending"',
    });
    const repaired = repairTodoRawInput(raw);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!) as { items: unknown[] };
    expect(parsed.items).toHaveLength(2);
  });

  it('非 add 动作或 items 已是数组时不干预', () => {
    const nonAdd = JSON.stringify({ action: 'update', id: '#1', status: 'completed' });
    expect(repairTodoRawInput(nonAdd)).toBeNull();

    const alreadyArray = JSON.stringify({ action: 'add', items: [{ subject: 'a' }] });
    expect(repairTodoRawInput(alreadyArray)).toBeNull();
  });

  it('无法解析的输入返回 null', () => {
    expect(repairTodoRawInput('{invalid json')).toBeNull();
    expect(repairTodoRawInput('{"action":"add","items":123}')).toBeNull();
  });
});