import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodo } from '../todo-create';
import { completeTodo, failTodo, updateTodoStatus } from '../todo-update';
import { createTodoWriteToolForConversation } from '../todo-tools/todo-write-tool';
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
    execute = createTodoWriteToolForConversation(store, CONV).execute! as any;
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

  it('已完成 todo 豁免真替换（不参与活跃编号，不被取消）', async () => {
    const done = createTodo(store, { conversationId: CONV, subject: '完成项' });
    completeTodo(store, done.id, 'OK');
    const active = createTodo(store, { conversationId: CONV, subject: '进行项' });
    createTodo(store, { conversationId: CONV, subject: '待办项' });

    // 父真替换只列 active（进行项）+ 一个新项；完成项历史、进行项保留，待办项未列 → 取消
    await execute({
      todos: [
        { index: 1, status: 'in_progress' }, // 进行项（createdAt 排序第一）
        { subject: '新任务', status: 'pending' },
      ],
    });

    const remaining = store.getTodosByConversation(CONV);
    expect(remaining.some(t => t.id === done.id)).toBe(true); // 完成项保留
    expect(remaining.find(t => t.id === done.id)?.status).toBe('completed');
    expect(remaining.find(t => t.id === active.id)?.status).toBe('in_progress'); // 已列 in_progress 保留
  });

  it('真替换：未列出的活跃待办被取消，in_progress 与已完成保留', async () => {
    const pending = createTodo(store, { conversationId: CONV, subject: '旧待办' });
    const doing = createTodo(store, { conversationId: CONV, subject: '进行中' });
    updateTodoStatus(store, doing.id, 'in_progress');
    const doneItem = createTodo(store, { conversationId: CONV, subject: '已完成' });
    completeTodo(store, doneItem.id, 'ok');

    // 只列 doing（index 指向进行项）+ 新任务；旧待办(未列 pending)应被取消
    // 活跃编号按 createdAt ASC：旧待办=1，进行中=2
    await execute({
      todos: [
        { index: 2, status: 'in_progress' }, // 进行中（排名第 2）
        { subject: '新任务', status: 'pending' },
      ],
    });

    const remaining = store.getTodosByConversation(CONV);
    expect(remaining.find(t => t.id === pending.id)?.status).toBe('cancelled'); // 未列 pending → 取消
    expect(remaining.find(t => t.id === doing.id)?.status).toBe('in_progress'); // 已列 in_progress 保留
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
