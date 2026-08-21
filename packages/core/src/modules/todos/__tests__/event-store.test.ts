import { describe, it, expect } from 'vitest';
import {
  MemoryTodoEventSink,
  SnapshotTodoStore,
  createTodoStore,
  deserializeTodos,
  withTodoReason,
} from '../event-store';

const CONV = 'conv-1';

describe('event-store: 快照事件账本', () => {
  it('每次 mutation 追加一条全量快照事件；当前态 = 最后一条', () => {
    const sink = new MemoryTodoEventSink();
    const store = new SnapshotTodoStore(sink);

    store.createTodo({ conversationId: CONV, subject: 'A' });
    store.createTodo({ conversationId: CONV, subject: 'B' });
    store.updateTodo({ id: store.getTodosByConversation(CONV)[0].id, status: 'completed', metadata: { result: 'ok' } });

    const events = sink.loadAll();
    expect(events).toHaveLength(3);
    // 每例一条全量快照：payload 都是当刻全会话 todos 全集
    expect(JSON.parse(events[0].payload)).toHaveLength(1);
    expect(JSON.parse(events[1].payload)).toHaveLength(2);
    expect(JSON.parse(events[2].payload)).toHaveLength(2);
    // 终态由最后一条承载
    const last = deserializeTodos(events[2].payload);
    expect(last.find(t => t.subject === 'A')?.status).toBe('completed');
    expect(store.getTodosByConversation(CONV).length).toBe(2);
  });

  it('重建 == 直接写：同一 sink 新开 store，终态一致、编号不变', () => {
    const sink = new MemoryTodoEventSink();
    const store = new SnapshotTodoStore(sink);
    store.createTodo({ conversationId: CONV, subject: 'A' });
    store.createTodo({ conversationId: CONV, subject: 'B' });
    store.updateTodo({ id: store.getTodosByConversation(CONV)[0].id, status: 'in_progress' });
    store.deleteTodo(store.getTodosByConversation(CONV)[1].id); // 硬删 #2

    // 编号高水位跨硬删不回落：下一条新建 = #3，不复用 #2（D2）
    const d = store.createTodo({ conversationId: CONV, subject: 'D' });
    expect(d.number).toBe(3);

    const rebuilt = new SnapshotTodoStore(sink);
    expect(rebuilt.getTodosByConversation(CONV)).toEqual(store.getTodosByConversation(CONV));
    expect(rebuilt.getTodosByConversation(CONV).map(t => t.number)).toEqual([1, 3]);
  });

  it('#N 创建时物化、永不复用（T1：建 3 → 完成 #1 → 剩余编号仍是 2,3）', () => {
    const store = createTodoStore();

    const a = store.createTodo({ conversationId: CONV, subject: 'A' });
    const b = store.createTodo({ conversationId: CONV, subject: 'B' });
    const c = store.createTodo({ conversationId: CONV, subject: 'C' });
    expect([a.number, b.number, c.number]).toEqual([1, 2, 3]);

    // 完成 #1：编号不重排、不复用（#2/#3 恒为物化值）
    store.updateTodo({ id: a.id, status: 'completed' });
    expect(store.getTodosByConversation(CONV).map(t => t.number)).toEqual([1, 2, 3]);

    // delete 是软取消：编号占用保留
    store.deleteTodo(b.id);
    const d = store.createTodo({ conversationId: CONV, subject: 'D' });
    expect(d.number).toBe(4);

    store.clearAllTodos();
    expect(store.getTodosByConversation(CONV)).toHaveLength(0);
  });

  it('getRevision 随每次 append 单调递增（全库单调）', () => {
    const sink = new MemoryTodoEventSink();
    const store = new SnapshotTodoStore(sink);
    store.createTodo({ conversationId: CONV, subject: 'A' });
    const r1 = store.getRevision();
    store.createTodo({ conversationId: CONV, subject: 'B' });
    expect(store.getRevision()).toBe(r1 + 1);
  });

  it('多会话互不干扰：每会话独立编号空间与快照', () => {
    const sink = new MemoryTodoEventSink();
    const store = new SnapshotTodoStore(sink);
    store.createTodo({ conversationId: 'c1', subject: 'A' });
    store.createTodo({ conversationId: 'c2', subject: 'X' });
    store.createTodo({ conversationId: 'c2', subject: 'Y' });

    expect(store.getTodosByConversation('c1').map(t => t.number)).toEqual([1]);
    expect(store.getTodosByConversation('c2').map(t => t.number)).toEqual([1, 2]);
    expect(store.getTodosByConversation('c3')).toEqual([]);
  });

  it('finalize downgrade 幂等：重复回卷终态一致，仅多一条附加事件（审计）', () => {
    const sink = new MemoryTodoEventSink();
    const store = new SnapshotTodoStore(sink);
    const t = store.createTodo({ conversationId: CONV, subject: 'A' });
    store.updateTodo({ id: t.id, status: 'in_progress', activeForm: 'Doing' });

    const downgrade = (reason: string) =>
      withTodoReason(store, 'run-downgrade', () => {
        store.updateTodo({
          id: t.id,
          status: 'pending',
          claimedBy: null,
          metadata: {
            ...((store.getTodo(t.id)?.metadata ?? {}) as object),
            execution: { interruptedAt: Date.now(), interruptedReason: reason },
          },
        });
      });

    downgrade('aborted');
    const afterFirst = store.getTodosByConversation(CONV).map(t => ({ ...t }));
    expect(afterFirst[0].status).toBe('pending');
    expect(afterFirst[0].claimedBy).toBeNull();

    downgrade('aborted');
    const afterSecond = store.getTodosByConversation(CONV).map(t => ({ ...t }));
    // 幂等：终态一致，事件多一条（快照即全量，追加无副作用）
    expect(afterSecond).toEqual(afterFirst);
    const events = sink.loadAll().filter(e => e.reason === 'run-downgrade');
    expect(events).toHaveLength(2);
    // 同一会话快照 payload 逐字节一致（等价态重复落账）
    expect(JSON.parse(events[1].payload)).toEqual(JSON.parse(events[0].payload));
  });

  it('withTodoReason 给事件打写方标签（审计 reason）；缺省 todo-tool，嵌套标注后复原', () => {
    const sink = new MemoryTodoEventSink();
    const store = new SnapshotTodoStore(sink);
    store.createTodo({ conversationId: CONV, subject: 'default' });

    withTodoReason(store, 'approval', () => {
      store.createTodo({ conversationId: CONV, subject: 'approved' });
      withTodoReason(store, 'api', () => {
        store.createTodo({ conversationId: CONV, subject: 'nested-api' });
      });
      store.createTodo({ conversationId: CONV, subject: 'approved-2' });
    });
    store.createTodo({ conversationId: CONV, subject: 'todo-tool' });

    const reasons = sink.loadAll().map(e => e.reason);
    expect(reasons).toEqual(['todo-tool', 'approval', 'api', 'approval', 'todo-tool']);
  });
});