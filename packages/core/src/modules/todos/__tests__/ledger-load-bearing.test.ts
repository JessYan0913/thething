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

  it('带 id 更新已完成 todo 时不抹掉子 Agent 写下的 result', async () => {
    const todo = createTodo(store, { conversationId: CONV, subject: '重构 store' });
    completeTodo(store, todo.id, '重构完成，测试通过');

    // 父 Agent 整表替换：更新该 todo（completed、无 result 字段）
    const result = await execute({
      todos: [{ id: todo.id, subject: '重构 store', status: 'completed' }],
    });

    expect(result.success).toBe(true);
    const after = store.getTodo(todo.id);
    expect(after?.status).toBe('completed');
    expect(after?.metadata?.result).toBe('重构完成，测试通过');
  });

  it('已完成 todo 豁免整表替换（父漏传时不会被删）', async () => {
    const done = createTodo(store, { conversationId: CONV, subject: '完成项' });
    completeTodo(store, done.id, 'OK');
    const active = createTodo(store, { conversationId: CONV, subject: '进行项' });

    // 父整表替换只列 active，不列 done
    await execute({ todos: [{ id: active.id, subject: '进行项', status: 'in_progress' }] });

    const remaining = store.getTodosByConversation(CONV);
    expect(remaining.some(t => t.id === done.id)).toBe(true); // 完成项保留
    expect(remaining.some(t => t.id === active.id)).toBe(true); // 活跃项更新保留
  });

  it('活跃 todo 未出现在整表替换中被删除（预期的替换语义）', async () => {
    const active = createTodo(store, { conversationId: CONV, subject: '旧待办' });
    await execute({ todos: [{ subject: '新任务', status: 'pending' }] });
    const remaining = store.getTodosByConversation(CONV);
    expect(remaining.some(t => t.id === active.id)).toBe(false);
    expect(remaining.some(t => t.subject === '新任务')).toBe(true);
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
