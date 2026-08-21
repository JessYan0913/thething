import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodoWriteToolForConversation, todoWriteToolSchema } from '../todo-tools/todo-write-tool';
import { createTodoRuntime, getLifecycle } from '../todo-runtime';
import type { TodoStore } from '../types';

const CONV = 'conv-1';

describe('todo_write (方案C：index 定位 + patch 语义 + merge)', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = new InMemoryTodoStore(new HighWaterMarkImpl());
    const runtime = createTodoRuntime({ store, conversationId: CONV });
    const tool = createTodoWriteToolForConversation(store, CONV, { scheduler: runtime });
    execute = tool.execute! as any;
  });

  // ---- 新建 ----

  it('creates new todos by subject (no index)', async () => {
    const result = await execute({
      todos: [
        { subject: 'Task A', status: 'in_progress', activeForm: 'Doing A' },
        { subject: 'Task B', status: 'pending' },
      ],
    });

    expect(result.success).toBe(true);
    const all = store.getTodosByConversation(CONV);
    expect(all).toHaveLength(2);
    expect(all.find(t => t.subject === 'Task A')?.status).toBe('in_progress');
    expect(all.find(t => t.subject === 'Task A')?.activeForm).toBe('Doing A');
    expect(all.find(t => t.subject === 'Task B')?.status).toBe('pending');
  });

  it('schema rejects creating a new todo without subject (no index)', () => {
    const parsed = todoWriteToolSchema.safeParse({ todos: [{ status: 'in_progress' }] });
    expect(parsed.success).toBe(false);
  });

  // ---- 按 index 更新 ----

  it('updates an existing todo by index (subject optional → keeps title)', async () => {
    await execute({ todos: [{ subject: 'Task A', status: 'in_progress' }] });
    const id = store.getTodosByConversation(CONV)[0].id;

    const result = await execute({ todos: [{ index: 1, status: 'completed', result: 'done and verified' }] });

    expect(result.success).toBe(true);
    const after = store.getTodo(id)!;
    expect(after.status).toBe('completed');
    expect(after.subject).toBe('Task A'); // 沿用标题
    expect(after.metadata?.result).toBe('done and verified');
  });

  it('updates by index and keeps omitted metadata (verify not lost)', async () => {
    await execute({ todos: [{ subject: 'Task A', status: 'in_progress', verify: 'npx vitest passes' }] });
    const id = store.getTodosByConversation(CONV)[0].id;

    await execute({ todos: [{ index: 1, status: 'completed', result: 'green' }] });

    const after = store.getTodo(id)!;
    expect(after.metadata?.verify).toBe('npx vitest passes');
    expect(after.metadata?.result).toBe('green');
  });

  it('rejects an out-of-range / stale index instead of silently creating', async () => {
    await execute({ todos: [{ subject: 'Task A', status: 'in_progress' }] });
    const before = store.getTodosByConversation(CONV).length;

    const result = await execute({ todos: [{ index: 7, subject: 'Ghost', status: 'pending' }] });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/index 7/);
    // 没有静默新建第 8 行
    expect(store.getTodosByConversation(CONV)).toHaveLength(before);
  });

  it('hints the terminal status when an index refers to a finished task (T5: 含终态给予提示)', async () => {
    await execute({ todos: [{ subject: 'Task A', status: 'in_progress' }] });
    // 完成 #1 → 编号 1 不再出现在活跃清单（稳定编号，收尾行占号不移位）
    await execute({ todos: [{ index: 1, status: 'completed', result: 'done' }] });

    const result = await execute({ todos: [{ index: 1, status: 'in_progress' }] });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already completed'); // 终态提示而非泛化「不存在」
    // 未迁到活跃清单 → 不会误重开完成的行
    expect(store.getTodosByConversation(CONV).find(t => t.subject === 'Task A')?.status).toBe('completed');
  });

  // ---- patch 语义：未提及的项原样保留 ----

  it('patch: unlisted active todos are left untouched (no auto-cancel)', async () => {
    await execute({
      todos: [
        { subject: 'A', status: 'in_progress' },
        { subject: 'B', status: 'pending' },
        { subject: 'C', status: 'pending' },
      ],
    });

    // 只引用 A(1) 更新 + 新增 D；B(2)、C(3) 未列出 → 原样保留（不取消）
    await execute({ todos: [{ index: 1, status: 'in_progress' }, { subject: 'D', status: 'pending' }] });

    const all = store.getTodosByConversation(CONV);
    expect(all.find(t => t.subject === 'A')?.status).toBe('in_progress'); // 已列出 → 更新
    expect(all.find(t => t.subject === 'D')?.status).toBe('pending'); // 新增
    expect(all.find(t => t.subject === 'B')?.status).toBe('pending'); // 未列出 → 保留
    expect(all.find(t => t.subject === 'C')?.status).toBe('pending'); // 未列出 → 保留
  });

  it('explicit cancel: index + status cancelled ends a task', async () => {
    await execute({ todos: [{ subject: 'A', status: 'pending' }, { subject: 'B', status: 'pending' }] });

    await execute({ todos: [{ index: 1, status: 'cancelled' }] });

    const all = store.getTodosByConversation(CONV);
    expect(all.find(t => t.subject === 'A')?.status).toBe('cancelled');
    expect(all.find(t => t.subject === 'B')?.status).toBe('pending'); // 未提及 → 保留
  });

  it('no auto-cancellation when nothing is referenced', async () => {
    await execute({ todos: [{ subject: 'A', status: 'in_progress' }, { subject: 'B', status: 'pending' }] });

    // 不引用任何 index，只新增 D → A、B 都保持原状
    await execute({ todos: [{ subject: 'D', status: 'pending' }] });

    const all = store.getTodosByConversation(CONV);
    expect(all.find(t => t.subject === 'A')?.status).toBe('in_progress');
    expect(all.find(t => t.subject === 'B')?.status).toBe('pending');
  });

  // ---- merge：语义重复合一 ----

  it('merge folds a semantic duplicate into the kept task (no duplicate rows)', async () => {
    await execute({
      todos: [
        { subject: '调研X', status: 'in_progress' }, // index 1 (created first)
        { subject: '写X', status: 'pending' },        // index 2
      ],
    });
    const ids = store.getTodosByConversation(CONV).map(t => t.id);

    const result = await execute({ merge: [{ keepIndex: 1, dropIndices: [2], subject: '写X' }] });

    expect(result.success).toBe(true);
    const all = store.getTodosByConversation(CONV);
    expect(all).toHaveLength(2); // 1 kept + 1 cancelled，没有第三行
    const kept = all.find(t => t.id === ids[0])!;
    expect(kept.subject).toBe('写X'); // 标题按 merge.subject 更新
    expect(kept.status).toBe('in_progress');
    const dropped = all.find(t => t.id === ids[1])!;
    expect(dropped.status).toBe('cancelled');
    expect(getLifecycle(dropped).mergedInto).toBe(ids[0]);
  });

  it('merge keeps the kept task active and drops the row', async () => {
    await execute({
      todos: [
        { subject: 'A', status: 'in_progress' },
        { subject: 'A', status: 'pending' }, // 字面重复也由 agent 显式 merge（机器零去重）
      ],
    });
    const before = store.getTodosByConversation(CONV);
    expect(before).toHaveLength(2); // 机器不自动去重

    await execute({ merge: [{ keepIndex: 1, dropIndices: [2] }] });

    const after = store.getTodosByConversation(CONV);
    expect(after.filter(t => isActive(t))).toHaveLength(1); // 只剩一个活跃
    expect(after.find(t => t.subject === 'A' && isActive(t))?.status).toBe('in_progress');
  });

  it('merge errors when keepIndex/dropIndex is stale', async () => {
    await execute({ todos: [{ subject: 'A', status: 'in_progress' }] });
    const result = await execute({ merge: [{ keepIndex: 99, dropIndices: [1] }] });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/keepIndex 99/);
  });

  // ---- 输出快照 ----

  it('returns the latest indexed active snapshot for the next turn', async () => {
    await execute({ todos: [{ subject: '调研X', status: 'in_progress' }, { subject: '写X', status: 'pending' }] });

    const result = await execute({
      todos: [
        { index: 1, status: 'in_progress' },
        { index: 2, status: 'pending' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.todos).toContainEqual(expect.objectContaining({ index: 1, subject: '调研X' }));
    expect(result.todos).toContainEqual(expect.objectContaining({ index: 2, subject: '写X' }));
    expect(result.snapshot).toMatch(/\[#1\]/);
    expect(result.snapshot).toMatch(/\[#2\]/);
    expect(result.snapshot).not.toContain('todo-'); // 无 id
  });

  // ---- 规划警告（T2：不阻断，lint 提示）----

  it('warns (lint, 不阻断) when more than one is in_progress', async () => {
    // T2：单进行中门拆除 → 第二个 in_progress 不再被拒，仅返回 lint 警告
    const result = await execute({
      todos: [{ subject: 'A', status: 'in_progress' }, { subject: 'B', status: 'in_progress' }],
    });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/in_progress/);
    expect(result.message).toMatch(/exactly one/i);
  });

  it('warns when the same index is referenced twice in one call', async () => {
    await execute({ todos: [{ subject: 'A', status: 'pending' }, { subject: 'B', status: 'pending' }] });
    const result = await execute({
      todos: [
        { index: 1, status: 'pending' },
        { index: 1, status: 'in_progress' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain('index 1');
    expect(result.message).toContain('referenced more than once');
  });

  it('warns when completed without result', async () => {
    const result = await execute({ todos: [{ subject: 'A', status: 'completed' }] });
    expect(result.message).toContain('completed without a result');
  });

  it('warns when failed without error', async () => {
    const result = await execute({ todos: [{ subject: 'A', status: 'failed' }] });
    expect(result.message).toContain('failed without an error');
  });

  it('warns (lint, 不阻断) when creating a subject matching an existing active todo', async () => {
    await execute({ todos: [{ subject: '调研X', status: 'in_progress' }] });
    // 模型把已有任务当新任务再发一次（无 index）→ 不拦截、不静默，给出 [#1] 提示
    const result = await execute({ todos: [{ subject: '调研X', status: 'in_progress' }] });

    expect(result.success).toBe(true);
    expect(result.message).toContain('#1');
    // 系统零去重：行确实建了，只提示由 agent 决定 update/merge
    expect(store.getTodosByConversation(CONV)).toHaveLength(2);
  });

  it('warns when the same subject is created twice in one call', async () => {
    const result = await execute({
      todos: [{ subject: 'A', status: 'pending' }, { subject: 'A', status: 'pending' }],
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('twice in this call');
    expect(store.getTodosByConversation(CONV)).toHaveLength(2);
  });

  it('does not warn when creating a subject that only exists as a completed task', async () => {
    await execute({ todos: [{ subject: '调研X', status: 'in_progress' }] });
    await execute({ todos: [{ index: 1, status: 'completed', result: 'done' }] });

    // 终态历史不参与活跃清单 → 重新调研不判重复
    const result = await execute({ todos: [{ subject: '调研X', status: 'pending' }] });

    expect(result.success).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('does not warn when completed carries result / failed carries error', async () => {
    const ok = await execute({ todos: [{ subject: 'A', status: 'completed', result: 'done' }] });
    expect(ok.message).toBeUndefined();
    const ok2 = await execute({ todos: [{ subject: 'B', status: 'failed', error: 'boom' }] });
    expect(ok2.message).toBeUndefined();
  });

  // ---- 单完成约束（T5：硬失败 → lint）----

  it('warns (lint, 不阻断) when marking multiple todos completed in one call', async () => {
    await execute({ todos: [{ subject: 'A', status: 'in_progress' }, { subject: 'B', status: 'in_progress' }] });

    const result = await execute({
      todos: [
        { index: 1, status: 'completed', result: 'done' },
        { index: 2, status: 'completed', result: 'done too' },
      ],
    });

    expect(result.success).toBe(true); // T5：硬失败降级为 lint
    expect(result.message).toContain('completed/failed');
    const all = store.getTodosByConversation(CONV);
    expect(all.filter(t => t.status === 'completed')).toHaveLength(2); // 两个都完成，机器不拦
  });

  // ---- 会话隔离 ----

  it('does not touch todos of other conversations', async () => {
    store.createTodo({ conversationId: 'other-conv', subject: 'Other task' });
    await execute({ todos: [{ subject: 'Mine', status: 'pending' }] });

    expect(store.getTodosByConversation('other-conv')).toHaveLength(1);
  });
});

function isActive(t: { status: string }): boolean {
  return t.status === 'pending' || t.status === 'in_progress' || t.status === 'failed';
}
