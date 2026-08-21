import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodo } from '../todo-create';
import { completeTodo, failTodo, updateTodoStatus } from '../todo-update';
import { createTodoWriteToolForConversation } from '../todo-tools/todo-write-tool';
import { createTodoRuntime } from '../todo-runtime';
import { buildCompactTaskSnapshot } from '../todo-tools/todo-snapshot';
import type { TodoStore } from '../types';

// ============================================================
// Phase B 账本承重不变量
// ============================================================
// 账本（todo store）是执行状态的可靠来源。这些测试钉死：
// 1. 委托回写：子 Agent completeTodo/failTodo 把结果写进账本
// 2. 不变量保持：父 todo_write 整表替换不会抹掉子 Agent 写的结果/已完成记录
// 3. 快照即续做依据：压缩/续做注入的快照包含 result/verify/error

const CONV = 'conv-1';

function makeStore(): TodoStore {
  return new InMemoryTodoStore(new HighWaterMarkImpl());
}

describe('账本承重：委托回写闭环', () => {
  let store: TodoStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('子 Agent 启动：todo 置 in_progress，activeForm 清除', () => {
    const todo = createTodo(store, { conversationId: CONV, subject: 'T' });
    updateTodoStatus(store, todo.id, 'in_progress');
    expect(store.getTodo(todo.id)?.status).toBe('in_progress');
  });

  it('子 Agent 完成：completeTodo 写入 result 到账本', () => {
    const todo = createTodo(store, { conversationId: CONV, subject: 'T' });
    const done = completeTodo(store, todo.id, '改动完成，测试通过');
    expect(done?.status).toBe('completed');
    expect(done?.metadata?.result).toBe('改动完成，测试通过');
  });

  it('子 Agent 失败：failTodo 写入 error 到账本', () => {
    const todo = createTodo(store, { conversationId: CONV, subject: 'T' });
    const failed = failTodo(store, todo.id, '构建超时');
    expect(failed?.status).toBe('failed');
    expect(failed?.metadata?.error).toBe('构建超时');
  });
});

describe('账本承重：父 todo_write 不破坏账本', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = makeStore();
    const runtime = createTodoRuntime({ store, conversationId: CONV });
    execute = createTodoWriteToolForConversation(store, CONV, { scheduler: runtime }).execute! as any;
  });

  it('按 index 更新已完成 todo 时不抹掉子 Agent 写下的 result', async () => {
    const todo = createTodo(store, { conversationId: CONV, subject: '重构 store' });
    completeTodo(store, todo.id, '重构完成，测试通过');

    // 已完成项不占活跃编号 → 用 index 无法引用；父 Agent 只列其它活跃项不受影响
    const result = await execute({
      todos: [{ subject: '新活跃项', status: 'pending' }],
    });

    expect(result.success).toBe(true);
    const after = store.getTodo(todo.id);
    expect(after?.status).toBe('completed');
    expect(after?.metadata?.result).toBe('重构完成，测试通过'); // 子 Agent 结果未被抹
  });

  it('patch 语义：todo_write 不破坏已完成项，未列出的活跃项原样保留', async () => {
    const done = createTodo(store, { conversationId: CONV, subject: '完成项' });
    completeTodo(store, done.id, 'OK');
    const active = createTodo(store, { conversationId: CONV, subject: '进行项' });
    const pending = createTodo(store, { conversationId: CONV, subject: '待办项' });

    // 稳定编号 = 创建序（含终态占位）：完成项=#1、进行项=#2、待办项=#3。
    // 完成 #1 后其余编号不重排 → 引用进行项用 index: 2。
    // patch：只更新进行项（index 2 → in_progress）+ 新增；完成项历史保留，未列出的待办项原样保留。
    await execute({
      todos: [
        { index: 2, status: 'in_progress' },
        { subject: '新任务', status: 'pending' },
      ],
    });

    const remaining = store.getTodosByConversation(CONV);
    expect(remaining.find(t => t.id === done.id)?.status).toBe('completed'); // 已完成历史保留
    expect(remaining.find(t => t.id === active.id)?.status).toBe('in_progress'); // 已列 → 更新
    expect(remaining.find(t => t.id === pending.id)?.status).toBe('pending'); // 未列出 → 保留
    expect(remaining.some(t => t.subject === '新任务' && t.status === 'pending')).toBe(true);
  });

  it('patch 语义：只更新入参引用的项，其他活跃项不被抹掉', async () => {
    const pending = createTodo(store, { conversationId: CONV, subject: '旧待办' });
    const doing = createTodo(store, { conversationId: CONV, subject: '进行中' });
    updateTodoStatus(store, doing.id, 'in_progress');
    const doneItem = createTodo(store, { conversationId: CONV, subject: '已完成' });
    completeTodo(store, doneItem.id, 'ok');

    // 只更新进行项（index 引用）+ 新增新任务；旧待办未提及 → 保持 pending
    await execute({
      todos: [
        { index: 2, status: 'in_progress' }, // 进行中（活跃编号第 2）
        { subject: '新任务', status: 'pending' },
      ],
    });

    const remaining = store.getTodosByConversation(CONV);
    expect(remaining.find(t => t.id === pending.id)?.status).toBe('pending'); // 未提及 → 保留
    expect(remaining.find(t => t.id === doing.id)?.status).toBe('in_progress'); // 已列 → 更新保留
    expect(remaining.find(t => t.id === doneItem.id)?.status).toBe('completed'); // 已完成历史保留
    expect(remaining.some(t => t.subject === '新任务' && t.status === 'pending')).toBe(true);
  });
});

describe('账本承重：快照是压缩/续做的依据', () => {
  it('快照包含已完成项的 result、待办/进行中的 verify、失败项的 error', () => {
    const store = makeStore();

    const done = createTodo(store, { conversationId: CONV, subject: '写函数', metadata: { result: '函数已写并验证', verify: 'vitest 通过' } });
    completeTodo(store, done.id, '函数已写并验证');

    const doing = createTodo(store, { conversationId: CONV, subject: '写测试', metadata: { verify: '覆盖 3 个边界' } });
    updateTodoStatus(store, doing.id, 'in_progress');

    const fail = createTodo(store, { conversationId: CONV, subject: '跑 CI', metadata: { error: '网络超时' } });
    failTodo(store, fail.id, '网络超时');

    const snapshot = buildCompactTaskSnapshot(store.getTodosByConversation(CONV), store)!;
    expect(snapshot).toContain('函数已写并验证'); // result
    expect(snapshot).toContain('覆盖 3 个边界');   // verify
    expect(snapshot).toContain('网络超时');        // error
    expect(snapshot).toContain('失败: 1');         // 统计含失败数
  });

  it('空清单返回 null（不注入）', () => {
    const store = makeStore();
    expect(buildCompactTaskSnapshot([], store)).toBeNull();
  });
});
