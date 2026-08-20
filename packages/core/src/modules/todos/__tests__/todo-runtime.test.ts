import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTodoStore } from '../store';
import { HighWaterMarkImpl } from '../high-water-mark';
import { createTodoRuntime, TODO_TRANSITIONS, getExecution, getLifecycle, getVerification, getArchive } from '../todo-runtime';
import { createTodo, createTodoWithDependencies } from '../todo-create';
import type { TodoRuntime } from '../todo-runtime';
import type { TodoStore } from '../types';

const CONV = 'conv-1';

function makeScheduler(opts?: {
  enforceSingleInProgress?: boolean;
  archiveQueue?: Map<string, string>;
}): { store: TodoStore; scheduler: TodoRuntime } {
  const store = new InMemoryTodoStore(new HighWaterMarkImpl());
  const scheduler = createTodoRuntime({
    store,
    conversationId: CONV,
    enforceSingleInProgress: opts?.enforceSingleInProgress ?? true,
    pendingArchiveRetries: () => opts?.archiveQueue ?? new Map(),
  });
  return { store, scheduler };
}

describe('TODO_TRANSITIONS 迁移矩阵', () => {
  it('合法箭头：pending→in_progress→completed/failed/cancelled，failed→pending/cancelled', () => {
    expect(TODO_TRANSITIONS.pending).toEqual(['in_progress', 'cancelled']);
    expect(TODO_TRANSITIONS.in_progress).toEqual(['completed', 'failed', 'cancelled']);
    expect(TODO_TRANSITIONS.failed).toEqual(['pending', 'cancelled']);
  });

  it('terminal 无出边：completed/cancelled 不可回 active', () => {
    expect(TODO_TRANSITIONS.completed).toEqual([]);
    expect(TODO_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('claimTodo', () => {
  it('pending→in_progress 成功，写 metadata.execution', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    const claimed = scheduler.claimTodo(t.id, { agentId: 'main' });
    expect(claimed.status).toBe('in_progress');
    expect(claimed.claimedBy).toBe('main');
    expect(getExecution(claimed).startedAt).toBeTruthy();
    expect(getExecution(claimed).agentId).toBe('main');
  });

  it('重复 claim（已 in_progress）→ ALREADY_CLAIMED（不静默覆盖）', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(t.id, { agentId: 'main' });
    expect(() => scheduler.claimTodo(t.id, { agentId: 'main' })).toThrow(/ALREADY_CLAIMED/);
    expect(getExecution(store.getTodo(t.id)!).startedAt).toBeTruthy(); // 首 claim 不被覆盖
  });

  it('blocked（依赖未完成）→ DEPENDENCIES_UNMET', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodoWithDependencies(store, CONV, 'B', ['A']).todo;
    expect(() => scheduler.claimTodo(b.id, { agentId: 'main' })).toThrow(/DEPENDENCIES_UNMET/);
  });

  it('enforceSingleInProgress=true 时仅允许一个 in_progress → TOO_MANY_IN_PROGRESS', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodo(store, { conversationId: CONV, subject: 'B' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    expect(() => scheduler.claimTodo(b.id, { agentId: 'main' })).toThrow(/TOO_MANY_IN_PROGRESS/);
  });

  it('enforceSingleInProgress=false 允许并行 claim（parallel 场景）', () => {
    const { store, scheduler } = makeScheduler({ enforceSingleInProgress: false });
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodo(store, { conversationId: CONV, subject: 'B' });
    scheduler.claimTodo(a.id, { agentId: 'agent-a' });
    scheduler.claimTodo(b.id, { agentId: 'agent-b' });
    expect(store.getTodosByStatus('in_progress')).toHaveLength(2);
  });
});

describe('completeTodo / failTodo / retryTodo / cancelTodo', () => {
  it('in_progress→completed：写 result + execution.finishedAt，unblock 依赖', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodoWithDependencies(store, CONV, 'B', ['A']).todo;
    scheduler.claimTodo(a.id, { agentId: 'main' });
    const done = scheduler.completeTodo(a.id, '实现了 A');
    expect(done.status).toBe('completed');
    expect(done.metadata.result).toBe('实现了 A');
    expect((store.getTodo(a.id)!.metadata as any).result).toBe('实现了 A');
    expect(getExecution(store.getTodo(a.id)!).finishedAt).toBeTruthy();
    // 依赖解锁 → B 进 ready
    expect(scheduler.getReadyTodos().map(t => t.id)).toContain(b.id);
  });

  it('pending→completed 直翻被拒（必须经 in_progress）→ ILLEGAL_TRANSITION', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    expect(() => scheduler.completeTodo(t.id, 'x')).toThrow(/Illegal/);
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

  it('completed 不可直接回 active：complete 后再 claim/retry 均拒', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(t.id, { agentId: 'main' });
    scheduler.completeTodo(t.id, 'done');
    expect(() => scheduler.claimTodo(t.id, { agentId: 'main' })).toThrow(/Illegal/);
    expect(() => scheduler.retryTodo(t.id)).toThrow(/Illegal/);
  });

  it('pending/cancelled→cancelled 合法；completed→cancelled 被拒', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    const cancelled = scheduler.cancelTodo(t.id, 'obsolete');
    expect(cancelled.status).toBe('cancelled');
    expect(getLifecycle(cancelled).cancelReason).toBe('obsolete');
    // completed → cancelled 被拒
    const c2 = createTodo(store, { conversationId: CONV, subject: 'C' });
    scheduler.claimTodo(c2.id, { agentId: 'main' });
    scheduler.completeTodo(c2.id, 'done');
    expect(() => scheduler.cancelTodo(c2.id)).toThrow(/Illegal/);
  });
});

describe('Ready 派生（不存库）', () => {
  it('ready = pending + 依赖完成 + 未 claim；blocked 不进 ready', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodoWithDependencies(store, CONV, 'B', ['A']).todo;
    const c = createTodo(store, { conversationId: CONV, subject: 'C' });
    // a、c 直接 ready；b blocked
    const ready = scheduler.getReadyTodos().map(t => t.subject).sort();
    expect(ready).toEqual(['A', 'C']);
    expect(scheduler.getRuntimeState().blocked.map(t => t.subject)).toContain('B');
    // 无 ready 落库：status 仍全 pending
    expect(store.getTodosByStatus('pending')).toHaveLength(3);
  });
});

describe('Quiescent ≠ 完成', () => {
  it('有 failed/cancelled 但无 ready/in_progress/归档 → quiescent=true', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(t.id, { agentId: 'main' });
    scheduler.failTodo(t.id, 'x');
    expect(scheduler.isQuiescent()).toBe(true);
    expect(scheduler.getRuntimeState().quiescent).toBe(true);
    // 注意：failed 不算排空——这里是失败后无 active 工作，故仍 quiescent（系统无在跑工作）
  });

  it('有 in_progress → quiescent=false', () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(t.id, { agentId: 'main' });
    expect(scheduler.isQuiescent()).toBe(false);
  });

  it('待归档队列非空 → quiescent=false', () => {
    const queue = new Map([['todo-1', 'rendered text']]);
    const { store, scheduler } = makeScheduler({ archiveQueue: queue });
    createTodo(store, { conversationId: CONV, subject: 'A' });
    expect(scheduler.isQuiescent()).toBe(false);
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

describe('todo_write + scheduler 集成（完全严格）', () => {
  it('声明 pending→completed 已存 todo 被拒（必须经 in_progress）', async () => {
    const { store, scheduler } = makeScheduler();
    const t = createTodo(store, { conversationId: CONV, subject: 'A' });
    // 用 file-style 直接造一个进行中→完成的合法链
    scheduler.claimTodo(t.id, { agentId: 'main' });
    // 现在把其翻回 pending，再尝试直翻 completed → 应被拒
    store.updateTodo({ id: t.id, status: 'pending', claimedBy: null });
    const { createTodoWriteToolForConversation } = await import('../todo-tools/todo-write-tool');
    const execute = createTodoWriteToolForConversation(store, CONV, { scheduler }).execute! as any;
    const res = await execute({ todos: [{ index: 1, status: 'completed', result: 'x' }] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Illegal status change/i);
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

  it('真替换取消未列出的 pending（经 scheduler.cancelTodo）', async () => {
    const { store, scheduler } = makeScheduler();
    const { createTodoWriteToolForConversation } = await import('../todo-tools/todo-write-tool');
    const execute = createTodoWriteToolForConversation(store, CONV, { scheduler }).execute! as any;
    await execute({ todos: [{ subject: 'A', status: 'pending' }] });
    await execute({ todos: [{ subject: 'B', status: 'pending' }] });
    const all = store.getTodosByConversation(CONV);
    expect(all.find(t => t.subject === 'A')?.status).toBe('cancelled');
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

  it('有 failed → failed（quiescent 但仍非完成候选）', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    scheduler.failTodo(a.id, 'boom');
    expect(scheduler.getRuntimeState().quiescenceReason).toBe('failed');
  });

  it('有 blocked（依赖被取消未解除）→ blocked', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    createTodoWithDependencies(store, CONV, 'B', ['A']);
    // A cancelled（非 failed）→ B 依赖未 completed → blocked；无 ready/in_progress/failed → quiescent(blocked)
    scheduler.cancelTodo(a.id, 'obsolete');
    const s = scheduler.getRuntimeState();
    expect(s.quiescent).toBe(true);
    expect(s.quiescenceReason).toBe('blocked');
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

  it('待归档队列非空 → 非 quiescent，quiescenceReason=null', () => {
    const queue = new Map([['todo-1', 't']]);
    const { store, scheduler } = makeScheduler({ archiveQueue: queue });
    createTodo(store, { conversationId: CONV, subject: 'A' });
    expect(scheduler.getRuntimeState().quiescenceReason).toBeNull();
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
    expect(f.readyTodos).toEqual([]);
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

describe('allowParallel claim（V3）', () => {
  it('allowParallel=true 跳过单进行中门，记 mode=parallel_agent', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodo(store, { conversationId: CONV, subject: 'B' });
    scheduler.claimTodo(a.id, { agentId: 'a', mode: 'parallel_agent', allowParallel: true });
    const claimed = scheduler.claimTodo(b.id, { agentId: 'b', mode: 'parallel_agent', allowParallel: true });
    expect(claimed.status).toBe('in_progress');
    expect(getExecution(claimed).mode).toBe('parallel_agent');
    expect(store.getTodosByStatus('in_progress')).toHaveLength(2);
  });

  it('allowParallel 下 blockedBy 依赖仍拒 → DEPENDENCIES_UNMET（Invariant 12）', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodoWithDependencies(store, CONV, 'B', ['A']).todo;
    scheduler.claimTodo(a.id, { agentId: 'a', allowParallel: true });
    expect(() => scheduler.claimTodo(b.id, { agentId: 'b', allowParallel: true }))
      .toThrow(/DEPENDENCIES_UNMET/);
  });

  it('allowParallel=false 默认仍受单进行中门约束', () => {
    const { store, scheduler } = makeScheduler();
    const a = createTodo(store, { conversationId: CONV, subject: 'A' });
    const b = createTodo(store, { conversationId: CONV, subject: 'B' });
    scheduler.claimTodo(a.id, { agentId: 'main' });
    expect(() => scheduler.claimTodo(b.id, { agentId: 'main' })).toThrow(/TOO_MANY_IN_PROGRESS/);
  });
});
