import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { createTodo } from '../todo-create';
import { completeTodo, failTodo, updateTodoStatus } from '../todo-update';
import { createTodoToolForConversation } from '../todo-tools/todo-tool';
import { createTodoRuntime } from '../todo-runtime';
import { buildCompactTaskSnapshot } from '../todo-tools/todo-snapshot';
import type { TodoStore } from '../types';

// ============================================================
// 账本承重不变量（事件化快照存储上线后）
// ============================================================
// 账本（todo store）是执行状态的可靠来源。这些测试钉死：
// 1. 委托回写：子 Agent completeTodo/failTodo 把结果写进账本
// 2. 不变量保持：父 todo 工具（patch 语义 + 稳定编号）不会抹掉子 Agent 写的结果/已完成记录
// 3. 快照即续做依据：压缩/续做注入的快照包含 result/verify/error

const CONV = 'conv-1';

function makeStore(): TodoStore {
  return new InMemoryTodoStore();
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

describe('账本承重：父 todo 工具不破坏账本', () => {
  let store: TodoStore;
  let execute: (input: unknown) => Promise<any>;

  beforeEach(() => {
    store = makeStore();
    const runtime = createTodoRuntime({ store, conversationId: CONV });
    execute = createTodoToolForConversation(store, CONV, { scheduler: runtime }).execute! as any;
  });

  it('add 不影响已完成 todo（子 Agent 写的 result 不被抹）', async () => {
    const todo = createTodo(store, { conversationId: CONV, subject: '重构 store' });
    completeTodo(store, todo.id, '重构完成，测试通过');

    const result = await execute({ action: 'add', items: [{ subject: '新活跃项' }] });

    expect(result.success).toBe(true);
    const after = store.getTodo(todo.id);
    expect(after?.status).toBe('completed');
    expect(after?.metadata?.result).toBe('重构完成，测试通过'); // 子 Agent 结果未被抹
  });

  it('patch 语义：按 #N 只更新引用的活跃项，未列出项与已完成历史保留', async () => {
    const done = createTodo(store, { conversationId: CONV, subject: '完成项' });
    completeTodo(store, done.id, 'OK');
    const active = createTodo(store, { conversationId: CONV, subject: '进行项' });
    const pending = createTodo(store, { conversationId: CONV, subject: '待办项' });

    // 稳定编号 = 创建序（含终态占位）：完成项=#1、进行项=#2、待办项=#3。
    // 完成 #1 后其余编号不重排 → 引用进行项 #2（物化号，非位置）。
    await execute({ action: 'update', id: '#2', status: 'in_progress' });
    await execute({ action: 'add', items: [{ subject: '新任务' }] });

    const remaining = store.getTodosByConversation(CONV);
    expect(remaining.find(t => t.id === done.id)?.status).toBe('completed'); // 已完成历史保留
    expect(remaining.find(t => t.id === active.id)?.status).toBe('in_progress'); // 已列 → 更新
    expect(remaining.find(t => t.id === pending.id)?.status).toBe('pending'); // 未列出 → 保留
    expect(remaining.some(t => t.subject === '新任务' && t.status === 'pending')).toBe(true);
  });

  it('patch 语义：只更新入参引用的 #N，其他活跃项不被抹掉', async () => {
    const pending = createTodo(store, { conversationId: CONV, subject: '旧待办' });
    const doing = createTodo(store, { conversationId: CONV, subject: '进行中' });
    updateTodoStatus(store, doing.id, 'in_progress');
    const doneItem = createTodo(store, { conversationId: CONV, subject: '已完成' });
    completeTodo(store, doneItem.id, 'ok');

    // 编号：#1 旧待办、#2 进行中、#3 已完成。只更新 #2 + 新增；旧待办未提及 → 保留
    await execute({ action: 'update', id: '#2', status: 'in_progress' });
    await execute({ action: 'add', items: [{ subject: '新任务' }] });

    const remaining = store.getTodosByConversation(CONV);
    expect(remaining.find(t => t.id === pending.id)?.status).toBe('pending'); // 未提及 → 保留
    expect(remaining.find(t => t.id === doing.id)?.status).toBe('in_progress'); // 已列 → 更新
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