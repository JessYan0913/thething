import { describe, it, expect } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodoRuntime, TODO_TRANSITIONS, getExecution, getLifecycle, getVerification, getArchive } from '../todo-runtime';
import { createTodo, createTodoWithDependencies } from '../todo-create';
import type { TodoRuntime } from '../todo-runtime';
import type { TodoStore } from '../types';

const CONV = 'conv-1';
const CONV2 = 'conv-2';

function makeScheduler(conversationId = CONV): { store: TodoStore; scheduler: TodoRuntime } {
  const store = new InMemoryTodoStore(new HighWaterMarkImpl());
  const scheduler = createTodoRuntime({ store, conversationId });
  return { store, scheduler };
}

describe('TODO_TRANSITIONS 迁移矩阵（T2：仅参考资料，不再执行）', () => {
  it('记录常见合法箭头（供 lint 建议参考）', () => {
    expect(TODO_TRANSITIONS.pending).toEqual(['in_progress', 'cancelled']);
    expect(TODO_TRANSITIONS.in_progress).toEqual(['completed', 'failed', 'cancelled']);
    expect(TODO_TRANSITIONS.failed).toEqual(['pending', 'cancelled']);
    expect(TODO_TRANSITIONS.completed).toEqual([]);
    expect(TODO_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('claimTodo（T2：无闸门，claim = 标 in_progress + 记执行者）', () => {
  it('pending→in_progress 成功，写 metadata.execution 与 claimedBy', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    const claimed = scheduler.claimTodo(t.id, { agentId: 'main' });
    expect(claimed.status).toBe('in_progress');
    expect(claimed.claimedBy).toBe('main');
    expect(getExecution(claimed).startedAt).toBeTruthy();
    expect(getExecution(claimed).agentId).toBe('main');
  });

  it('重复 claim（已 in_progress）不再被拒——幂等重申', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(t.id, { agentId: 'main' });
    // T2：删 ALREADY_CLAIMED 闸门 → 重复 claim 直接成功
    const again = scheduler.claimTodo(t.id, { agentId: 'main' });
    expect(again.status).toBe('in_progress');
    expect(store.getTodosByStatus('in_progress')).toHaveLength(1);
  });

  it('blocked（依赖未完成）不再阻塞 claim——依赖降级为提示字段', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodoWithDependencies(store, CONV, 'B', ['A']).todo;
    const claimed = scheduler.claimTodo(b.id, { agentId: 'main' });
    expect(claimed.status).toBe('in_progress'); // T2：不再抛 DEPENDENCIES_UNMET
  });

  it('不再强制「单一 in_progress」——两个 in_progress 并行 claim 都成功', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodo(store, { conversationId: CONV, subject: 'B' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    scheduler.claimTodo(b.id, { agentId: 'main' });
    expect(store.getTodosByStatus('in_progress')).toHaveLength(2);
  });

  it('跨会话：他会话已有 in_progress 不再卡本会话 claim（P1 消除）', () => {
    const storeA = new InMemoryTodoStore(new HighWaterMarkImpl());
    const storeB = new InMemoryTodoStore(new HighWaterMarkImpl());
    const schedA = createTodoRuntime({ store: storeA, conversationId: CONV });
    const schedB = createTodoRuntime({ store: storeB, conversationId: CONV2 });
    const a = createTodo(storeA, { conversationId: CONV, subject: 'A' });
    const b = createTodo(storeB, { conversationId: CONV2, subject: 'B' });
    schedA.claimTodo(a.id, { agentId: 'main' });
    const claimed = schedB.claimTodo(b.id, { agentId: 'main' }); // 不再 TOO_MANY_IN_PROGRESS
    expect(claimed.status).toBe('in_progress');
  });
});

describe('completeTodo / failTodo / retryTodo / cancelTodo（T2：任意迁移直通）', () => {
  it('in_progress→completed：写 result + execution.finishedAt，unblock 依赖', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodoWithDependencies(store, CONV, 'B', ['A']).todo;
    scheduler.claimTodo(a.id, { agentId: 'main' });
    const done = scheduler.completeTodo(a.id, '实现了 A');
    expect(done.status).toBe('completed');
    expect(done.metadata.result).toBe('实现了 A');
    expect(getExecution(store.getTodo(a.id)!).finishedAt).toBeTruthy();
    // 依赖解锁 → B 进 ready
    expect(scheduler.getReadyTodos().map(t => t.id)).toContain(b.id);
  });

  it('T2 验收：pending→completed 直通（不再要求先 in_progress）', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    const done = scheduler.completeTodo(t.id, '直接完成');
    expect(done.status).toBe('completed');
    expect(done.metadata.result).toBe('直接完成');
  });

  it('in_progress→failed：写 error + retryable', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(t.id, { agentId: 'main' });
    const failed = scheduler.failTodo(t.id, 'boom', true);
    expect(failed.status).toBe('failed');
    expect(failed.metadata.error).toBe('boom');
    expect(getExecution(failed).retryable).toBe(true);
  });

  it('failed→pending 经 retryTodo：retries 递增、error 清空', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(t.id, { agentId: 'main' });
    scheduler.failTodo(t.id, 'boom');
    const retried = scheduler.retryTodo(t.id);
    expect(retried.status).toBe('pending');
    expect(getLifecycle(retried).retries).toBe(1);
    expect(retried.metadata.error).toBeUndefined();
  });

  it('终态→active 重开：completed 后再 claim / retry 均允许（账本不判）', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(t.id, { agentId: 'main' });
    scheduler.completeTodo(t.id, 'done');
    // 重开 → 直接 claim 到 in_progress
    const reopened = scheduler.claimTodo(t.id, { agentId: 'main' });
    expect(reopened.status).toBe('in_progress');
    // 也可 retry 回 pending
    scheduler.completeTodo(t.id, 'done again');
    const again = scheduler.retryTodo(t.id);
    expect(again.status).toBe('pending');
  });

  it('completed→cancelled 允许（任意迁移，含终态之间）', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    const cancelled = scheduler.cancelTodo(t.id, 'obsolete');
    expect(cancelled.status).toBe('cancelled');
    expect(getLifecycle(cancelled).cancelReason).toBe('obsolete');
    // 已完成也能直接取消
    const c2 = createTodo(store, { conversationId: CONV, subject: 'C' });
    scheduler.claimTodo(c2.id, { agentId: 'main' });
    scheduler.completeTodo(c2.id, 'done');
    const c2Cancelled = scheduler.cancelTodo(c2.id);
    expect(c2Cancelled.status).toBe('cancelled');
  });
});

describe('Ready 派生（不存库，退化为展示/lint）', () => {
  it('ready = pending + 依赖完成 + 未 claim；blocked 不进 ready', () => {
    const { store, scheduler } = makeScheduler();
    createTodo(store, { conversationId: CONV, subject: 'A' });
    createTodoWithDependencies(store, CONV, 'B', ['A']);
    createTodo(store, { conversationId: CONV, subject: 'C' });
    const ready = scheduler.getReadyTodos().map(t => t.subject).sort();
    expect(ready).toEqual(['A', 'C']);
    expect(scheduler.getRuntimeState().blocked.map(t => t.subject)).toContain('B');
    expect(store.getTodosByStatus('pending')).toHaveLength(3);
  });
});

describe('Quiescent ≠ 完成（账本收尾信号：不存在 {pending,in_progress,failed}）', () => {
  it('有 failed → quiescent=false（失败是未处理的活，不是安静）', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    scheduler.failTodo(a.id, 'x');
    expect(scheduler.isQuiescent()).toBe(false);
    expect(scheduler.getRuntimeState().quiescent).toBe(false);
  });

  it('cancelled 是终态 → 全 cancelled 无其余活跃 → quiescent=true', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.cancelTodo(a.id, 'obsolete');
    expect(scheduler.isQuiescent()).toBe(true);
    expect(scheduler.getRuntimeState().quiescent).toBe(true);
  });

  it('有 in_progress → quiescent=false', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(t.id, { agentId: 'main' });
    expect(scheduler.isQuiescent()).toBe(false);
  });

  it('有 pending（即便依赖未完成）→ quiescent=false（依赖不再派生，pending 即算有活）', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    createTodoWithDependencies(store, CONV, 'B', ['A']);
    expect(scheduler.isQuiescent()).toBe(false);
    expect(scheduler.getRuntimeState().quiescent).toBe(false);
  });
});

describe('Metadata V2 访问器缺省值', () => {
  it('无 metadata 时访问器返回安全默认', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    expect(getExecution(t)).toEqual({});
    expect(getLifecycle(t)).toEqual({});
    expect(getVerification(t)).toEqual({});
    expect(getArchive(t)).toEqual({});
  });
});

describe('todo_write + scheduler 集成（无闸门）', () => {
  it('T2 验收：pending→completed 直通（todo_write 层不再 ILLEGAL_TRANSITION）', async () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    store.updateTodo({ id: t.id, status: 'pending', claimedBy: null });
    const { createTodoWriteToolForConversation } = await import('../todo-tools/todo-write-tool');
    const execute = createTodoWriteToolForConversation(store, CONV, { scheduler }).execute! as any;
    const res = await execute({ todos: [{ index: 1, status: 'completed', result: 'x' }] });
    expect(res.success).toBe(true);
    expect(store.getTodosByConversation(CONV)[0].status).toBe('completed');
  });

  it('新建即完成 走 internal claim→complete 链成功', async () => {
    const { store, scheduler } = makeScheduler();
    const { createTodoWriteToolForConversation } = await import('../todo-tools/todo-write-tool');
    const execute = createTodoWriteToolForConversation(store, CONV, { scheduler }).execute! as any;
    const res = await execute({ todos: [{ subject: 'T', status: 'completed', result: 'done' }] });
    expect(res.success).toBe(true);
    const t = store.getTodosByConversation(CONV).find(x => x.subject === 'T')!;
    expect(t.status).toBe('completed');
    expect(t.metadata.result).toBe('done');
  });

  it('no-op 重发 in_progress（方案C每轮整体重传）不报错', async () => {
    const { store, scheduler } = makeScheduler();
    const { createTodoWriteToolForConversation } = await import('../todo-tools/todo-write-tool');
    const execute = createTodoWriteToolForConversation(store, CONV, { scheduler }).execute! as any;
    await execute({ todos: [{ subject: 'A', status: 'in_progress' }] });
    const res = await execute({ todos: [{ index: 1, status: 'in_progress' }] });
    expect(res.success).toBe(true);
    expect(store.getTodosByStatus('in_progress')).toHaveLength(1);
  });

  it('patch 语义：未列出的 pending 保持原状（无自动取消）', async () => {
    const { store, scheduler } = makeScheduler();
    const { createTodoWriteToolForConversation } = await import('../todo-tools/todo-write-tool');
    const execute = createTodoWriteToolForConversation(store, CONV, { scheduler }).execute! as any;
    await execute({ todos: [{ subject: 'A', status: 'pending' }] });
    await execute({ todos: [{ subject: 'B', status: 'pending' }] });
    const all = store.getTodosByConversation(CONV);
    expect(all.find(t => t.subject === 'A')?.status).toBe('pending');
    expect(all.find(t => t.subject === 'B')?.status).toBe('pending');
  });
});

describe('quiescenceReason（V3）', () => {
  it('全 terminal（completed）→ completed_candidate', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    scheduler.completeTodo(a.id, 'done');
    const s = scheduler.getRuntimeState();
    expect(s.quiescent).toBe(true);
    expect(s.quiescenceReason).toBe('completed_candidate');
  });

  it('有 failed → 非 quiescent，quiescenceReason=null（失败仍需处理）', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    scheduler.failTodo(a.id, 'boom');
    const s = scheduler.getRuntimeState();
    expect(s.quiescent).toBe(false);
    expect(s.quiescenceReason).toBeNull();
  });

  it('有 pending（未完成依赖）→ 非 quiescent（依赖不再进收尾判定）', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    createTodoWithDependencies(store, CONV, 'B', ['A']);
    const s = scheduler.getRuntimeState();
    expect(s.quiescent).toBe(false);
    expect(s.quiescenceReason).toBeNull();
  });

  it('空会话（无任何 todo）→ no_work', () => {
    const { scheduler } = makeScheduler();
    expect(scheduler.getRuntimeState().quiescenceReason).toBe('no_work');
  });

  it('有 in_progress → 非 quiescent，quiescenceReason=null', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    const s = scheduler.getRuntimeState();
    expect(s.quiescent).toBe(false);
    expect(s.quiescenceReason).toBeNull();
  });
});

describe('getTaskFinishState（V3）', () => {
  it('返回统一终局视图（quiescent/reason/归档/就绪/进行中）', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    const f = scheduler.getTaskFinishState();
    expect(f.quiescent).toBe(false);
    expect(f.reason).toBeNull();
    expect(f.requiresCompletionAudit).toBe(false);
    expect(f.inProgressTodos.map(t => t.subject)).toContain('A');
    expect(f.pendingArchives).toEqual([]);
    expect(f.pendingRetries).toEqual([]);
  });

  it('quiescent 且全 terminal → reason=completed_candidate、requiresCompletionAudit=true', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    scheduler.completeTodo(a.id, 'done');
    const f = scheduler.getTaskFinishState();
    expect(f.quiescent).toBe(true);
    expect(f.reason).toBe('completed_candidate');
    expect(f.requiresCompletionAudit).toBe(true);
  });
});

describe('allowParallel claim（V3：单进行中门已拆除，allowParallel 仅记录）', () => {
  it('并存的多个 in_progress 均可 claim，mode 记录 parallel_agent', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodo(store, { conversationId: CONV, subject: 'B' });
    scheduler.claimTodo(a.id, { agentId: 'a', mode: 'parallel_agent', allowParallel: true });
    const claimed = scheduler.claimTodo(b.id, { agentId: 'b', mode: 'parallel_agent', allowParallel: true });
    expect(claimed.status).toBe('in_progress');
    expect(getExecution(claimed).mode).toBe('parallel_agent');
    expect(store.getTodosByStatus('in_progress')).toHaveLength(2);
  });

  it('allowParallel 下被依赖项 claim 也成功（依赖不再 gate）', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodoWithDependencies(store, CONV, 'B', ['A']).todo;
    scheduler.claimTodo(a.id, { agentId: 'a', allowParallel: true });
    const claimed = scheduler.claimTodo(b.id, { agentId: 'b', allowParallel: true });
    expect(claimed.status).toBe('in_progress');
  });

  it('非 allowParallel 也能并存多个 in_progress（单进行中门整体拆除）', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodo(store, { conversationId: CONV, subject: 'B' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    const claimed = scheduler.claimTodo(b.id, { agentId: 'main' });
    expect(claimed.status).toBe('in_progress');
  });
});