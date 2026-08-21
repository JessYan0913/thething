import { describe, it, expect } from 'vitest';
import type { Todo } from '../types';
import { isActiveStatus, indexActiveTodos, resolveActiveByIndex, resolveByStableIndex } from '../snapshot-index';

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
  it('稳定编号 = 创建序（含终态占位；已完成/取消不重排活跃项）', () => {
    const todos = [
      mk({ id: 'a', subject: '调研X', status: 'in_progress', createdAt: 30 }),
      mk({ id: 'b', subject: '写X', status: 'pending', createdAt: 10 }),
      mk({ id: 'c', subject: '验证', status: 'failed', createdAt: 20 }),
      mk({ id: 'd', subject: '已完', status: 'completed', createdAt: 5 }),
      mk({ id: 'e', subject: '已取消', status: 'cancelled', createdAt: 40 }),
    ];

    const indexed = indexActiveTodos(todos);

    // 创建序全序：#1=d(5) #2=b(10) #3=c(20) #4=a(30) #5=e(40)
    // 活跃视图只留活跃行，编号随创建序保留（可稀疏）
    expect(indexed).toHaveLength(3);
    expect(indexed.map(e => e.todo.id)).toEqual(['b', 'c', 'a']);
    expect(indexed.map(e => e.index)).toEqual([2, 3, 4]);
    expect(indexed[0].todo.subject).toBe('写X');
  });

  it('T1 验收：创建 3 项 → 完成 #1 → 剩余编号仍是 2,3；引用 #3 命中稳定行', () => {
    const t1 = mk({ id: 'a', subject: 'A', createdAt: 10 });
    const t2 = mk({ id: 'b', subject: 'B', createdAt: 20 });
    const t3 = mk({ id: 'c', subject: 'C', createdAt: 30 });

    const full = [t1, t2, t3];
    expect(indexActiveTodos(full).map(e => e.index)).toEqual([1, 2, 3]);

    // 完成 #1（a）：b、c 编号不动
    const after = indexActiveTodos([{ ...t1, status: 'completed' }, t2, t3]);
    expect(after.map(e => e.index)).toEqual([2, 3]);
    expect(after.map(e => e.todo.id)).toEqual(['b', 'c']);

    // 引用 #3 → 命中稳定行 c，而非被整体前移
    expect(resolveActiveByIndex([{ ...t1, status: 'completed' }, t2, t3], 3)?.id).toBe('c');
  });

  it('状态流转不改变编号（同一行编号恒定）', () => {
    const t1 = mk({ id: 'a', subject: 'A', status: 'pending', createdAt: 10 });
    const t2 = mk({ id: 'b', subject: 'B', status: 'pending', createdAt: 20 });

    expect(indexActiveTodos([t1, t2]).map(e => e.index)).toEqual([1, 2]);

    // A 完成：活跃只剩 B 且编号仍是 2
    const after = indexActiveTodos([{ ...t1, status: 'completed' }, t2]);
    expect(after).toHaveLength(1);
    expect(after[0].index).toBe(2);
    expect(after[0].todo.id).toBe('b');
  });
});

describe('snapshot-index: resolveActiveByIndex', () => {
  it('resolves a stable index to its active todo', () => {
    const todos = [
      mk({ id: 'a', subject: 'A', createdAt: 10 }),
      mk({ id: 'b', subject: 'B', createdAt: 20 }),
    ];
    expect(resolveActiveByIndex(todos, 1)?.id).toBe('a');
    expect(resolveActiveByIndex(todos, 2)?.id).toBe('b');
  });

  it('已收尾编号：活跃解析返回 undefined，稳定解析仍命中终态行', () => {
    const todos = [
      mk({ id: 'a', subject: 'A', createdAt: 10 }),
      mk({ id: 'c', subject: 'C', status: 'completed', createdAt: 30 }),
    ];
    // a=#1、c=#2(completed)
    expect(resolveActiveByIndex(todos, 1)?.id).toBe('a');
    expect(resolveActiveByIndex(todos, 2)).toBeUndefined(); // #2 已收尾，非活跃
    expect(resolveByStableIndex(todos, 2)?.id).toBe('c');   // 稳定编号仍命中终态行
    expect(resolveByStableIndex(todos, 0)).toBeUndefined();
    expect(resolveByStableIndex(todos, 99)).toBeUndefined();
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