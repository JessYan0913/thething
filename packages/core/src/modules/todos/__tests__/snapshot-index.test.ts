import { describe, it, expect } from 'vitest';
import type { Todo } from '../types';
import { isActiveStatus, indexActiveTodos, resolveActiveByIndex } from '../snapshot-index';

function mk(partial: Partial<Todo> & { id: string; subject: string; createdAt: number }): Todo {
  return {
    conversationId: 'conv-1',
    status: 'pending',
    claimedBy: null,
    activeForm: null,
    blockedBy: [],
    blocks: [],
    updatedAt: partial.createdAt,
    completedAt: null,
    metadata: {},
    ...partial,
  } as Todo;
}

describe('snapshot-index: indexActiveTodos', () => {
  it('numbers active todos by createdAt ASC (stable across status changes)', () => {
    const todos = [
      mk({ id: 'a', subject: '调研X', status: 'in_progress', createdAt: 30 }),
      mk({ id: 'b', subject: '写X', status: 'pending', createdAt: 10 }),
      mk({ id: 'c', subject: '验证', status: 'failed', createdAt: 20 }),
      mk({ id: 'd', subject: '已完', status: 'completed', createdAt: 5 }),
      mk({ id: 'e', subject: '已取消', status: 'cancelled', createdAt: 40 }),
    ];

    const indexed = indexActiveTodos(todos);

    // completed/cancelled 不参与编号
    expect(indexed).toHaveLength(3);
    // createdAt ASC: b(10) → c(20) → a(30)
    expect(indexed.map(e => e.todo.id)).toEqual(['b', 'c', 'a']);
    expect(indexed.map(e => e.index)).toEqual([1, 2, 3]);
    expect(indexed[0].todo.subject).toBe('写X');
  });

  it('index does not shift when a todo transitions status (same createdAt)', () => {
    const t1 = mk({ id: 'a', subject: 'A', status: 'pending', createdAt: 10 });
    const t2 = mk({ id: 'b', subject: 'B', status: 'pending', createdAt: 20 });

    // 初始：A=1, B=2
    expect(indexActiveTodos([t1, t2]).map(e => e.index)).toEqual([1, 2]);
    // A 变 in_progress，B 完成 → B 离开活跃；仍剩下 A=1
    const after = indexActiveTodos([{ ...t1, status: 'in_progress' }]);
    expect(after).toHaveLength(1);
    expect(after[0].index).toBe(1);
    expect(after[0].todo.id).toBe('a');
  });
});

describe('snapshot-index: resolveActiveByIndex', () => {
  it('resolves a 1-based index to its todo', () => {
    const todos = [
      mk({ id: 'a', subject: 'A', createdAt: 10 }),
      mk({ id: 'b', subject: 'B', createdAt: 20 }),
    ];
    expect(resolveActiveByIndex(todos, 1)?.id).toBe('a');
    expect(resolveActiveByIndex(todos, 2)?.id).toBe('b');
  });

  it('returns undefined for out-of-range / non-active index', () => {
    const todos = [
      mk({ id: 'a', subject: 'A', createdAt: 10 }),
      mk({ id: 'c', subject: 'C', status: 'completed', createdAt: 30 }),
    ];
    expect(resolveActiveByIndex(todos, 2)).toBeUndefined(); // 只有 a 一个活跃
    expect(resolveActiveByIndex(todos, 0)).toBeUndefined();
    expect(resolveActiveByIndex(todos, 99)).toBeUndefined();
  });
});

describe('snapshot-index: isActiveStatus', () => {
  it('classifies statuses', () => {
    expect(isActiveStatus('pending')).toBe(true);
    expect(isActiveStatus('in_progress')).toBe(true);
    expect(isActiveStatus('failed')).toBe(true);
    expect(isActiveStatus('completed')).toBe(false);
    expect(isActiveStatus('cancelled')).toBe(false);
  });
});
