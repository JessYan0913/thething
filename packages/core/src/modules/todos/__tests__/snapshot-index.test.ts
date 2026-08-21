import { describe, it, expect } from 'vitest';
import type { Todo } from '../types';
import { isActiveStatus, indexActiveTodos, resolveActiveByIndex, resolveByStableIndex } from '../snapshot-index';

function mk(partial: Partial<Todo> & { id: string; subject: string; number: number }): Todo {
  return {
    conversationId: 'conv-1',
    status: 'pending',
    claimedBy: null,
    activeForm: null,
    blockedBy: [],
    blocks: [],
    createdAt: partial.number * 10,
    updatedAt: partial.number * 10,
    completedAt: null,
    metadata: {},
    ...partial,
  } as Todo;
}

describe('snapshot-index: indexActiveTodos', () => {
  it('编号 = 创建时物化的 number（含终态占位；已完成/取消不重排活跃项）', () => {
    const todos = [
      mk({ id: 'a', subject: '调研X', status: 'in_progress', number: 4 }),
      mk({ id: 'b', subject: '写X', status: 'pending', number: 2 }),
      mk({ id: 'c', subject: '验证', status: 'failed', number: 3 }),
      mk({ id: 'd', subject: '已完', status: 'completed', number: 1 }),
      mk({ id: 'e', subject: '已取消', status: 'cancelled', number: 5 }),
    ];

    const indexed = indexActiveTodos(todos);

    // 物化编号全序：#1=d(completed) #2=b #3=c #4=a #5=e(cancelled)
    // 活跃视图只留活跃行，编号随物化值保留（可稀疏）
    expect(indexed).toHaveLength(3);
    expect(indexed.map(e => e.todo.id)).toEqual(['b', 'c', 'a']);
    expect(indexed.map(e => e.index)).toEqual([2, 3, 4]);
    expect(indexed[0].todo.subject).toBe('写X');
  });

  it('T1 验收：创建 3 项 → 完成 #1 → 剩余编号仍是 2,3；引用 #3 命中稳定行', () => {
    const t1 = mk({ id: 'a', subject: 'A', number: 1 });
    const t2 = mk({ id: 'b', subject: 'B', number: 2 });
    const t3 = mk({ id: 'c', subject: 'C', number: 3 });

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
    const t1 = mk({ id: 'a', subject: 'A', status: 'pending', number: 1 });
    const t2 = mk({ id: 'b', subject: 'B', status: 'pending', number: 2 });

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
      mk({ id: 'a', subject: 'A', number: 1 }),
      mk({ id: 'b', subject: 'B', number: 2 }),
    ];
    expect(resolveActiveByIndex(todos, 1)?.id).toBe('a');
    expect(resolveActiveByIndex(todos, 2)?.id).toBe('b');
  });

  it('已收尾编号：活跃解析返回 undefined，稳定解析仍命中终态行', () => {
    const todos = [
      mk({ id: 'a', subject: 'A', number: 1 }),
      mk({ id: 'c', subject: 'C', status: 'completed', number: 2 }),
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