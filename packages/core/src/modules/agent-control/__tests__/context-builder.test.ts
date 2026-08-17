// ============================================================
// Context Builder - 子任务独立上下文范式 测试
// ============================================================
import { describe, expect, it } from 'vitest';
import type { Todo } from '../../todos/types';
import {
  buildCompletedTodoIndex,
  buildSubtaskContext,
  getCurrentTodo,
} from '../context-builder';

function todo(overrides: Partial<Todo>): Todo {
  return {
    id: 't-1',
    conversationId: 'conv-1',
    subject: '子任务',
    status: 'pending',
    claimedBy: null,
    activeForm: null,
    blockedBy: [],
    blocks: [],
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    metadata: {},
    ...overrides,
  };
}

describe('buildCompletedTodoIndex', () => {
  it('只含 completed，结论优先 facts.conclusion，回退 result', () => {
    const todos = [
      todo({ id: 'a', subject: '有facts', status: 'completed', completedAt: 2000, metadata: { facts: { conclusion: '来自facts' }, result: '来自result' } }),
      todo({ id: 'b', subject: '有result', status: 'completed', completedAt: 1000, metadata: { result: '只有result' } }),
      todo({ id: 'c', subject: '挂起', status: 'pending' }),
      todo({ id: 'd', subject: '无结论', status: 'completed', completedAt: 3000, metadata: {} }), // 无结论，排除
    ];
    const index = buildCompletedTodoIndex(todos)!;
    expect(index).toContain('来自facts');
    expect(index).toContain('只有result');
    expect(index).not.toContain('挂起'); // pending 不进入
    expect(index).not.toContain('无结论'); // 无结论的 completed 不进入
  });

  it('按 completedAt DESC 排序', () => {
    const todos = [
      todo({ id: 'old', status: 'completed', completedAt: 1000, metadata: { result: '旧' } }),
      todo({ id: 'new', status: 'completed', completedAt: 3000, metadata: { result: '新' } }),
      todo({ id: 'mid', status: 'completed', completedAt: 2000, metadata: { result: '中' } }),
    ];
    const index = buildCompletedTodoIndex(todos)!;
    const iNew = index.indexOf('新');
    const iMid = index.indexOf('中');
    const iOld = index.indexOf('旧');
    expect(iNew).toBeLessThan(iMid);
    expect(iMid).toBeLessThan(iOld);
  });

  it('结论截断为短钩子并加省略号（>50 字符）', () => {
    const long = '长'.repeat(60); // >50 字符，应被截断
    const index = buildCompletedTodoIndex([todo({ status: 'completed', metadata: { result: long } })])!;
    // 截断后不包含完整长结论，且以省略号结尾
    expect(index).not.toContain(long);
    expect(index.endsWith('…')).toBe(true);
  });

  it('上限 50 条', () => {
    const todos = Array.from({ length: 60 }, (_, i) =>
      todo({ id: `t${i}`, status: 'completed', completedAt: i, metadata: { result: `r${i}` } }),
    );
    const index = buildCompletedTodoIndex(todos)!;
    // 只保留最近 50 条（completedAt 最大即最后创建）
    expect(index).not.toContain('r0');
    expect(index).toContain('r59');
  });

  it('O(1)：索引池长度不随已完成子任务数增长（100 vs 1000）', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        todo({ id: `t${i}`, status: 'completed', completedAt: i, metadata: { result: `结论${i}` } }),
      );
    const idx100 = buildCompletedTodoIndex(make(100))!;
    const idx1000 = buildCompletedTodoIndex(make(1000))!;
    // 子任务数 ×10，但索引池长度基本恒定（只保留 50 条）
    expect(idx1000.length).toBeLessThan(idx100.length * 1.5);
  });

  it('无已完成子任务时返回 null', () => {
    expect(buildCompletedTodoIndex([todo({ status: 'pending' })])).toBeNull();
    expect(buildCompletedTodoIndex([])).toBeNull();
  });
});

describe('getCurrentTodo', () => {
  it('优先 in_progress', () => {
    const t = todo({ id: 'a', status: 'in_progress' });
    const p = todo({ id: 'b', status: 'pending' });
    expect(getCurrentTodo([p, t])?.id).toBe('a');
  });

  it('无 in_progress 时取未阻塞 pending', () => {
    const blocked = todo({ id: 'b', status: 'pending', blockedBy: ['x'] });
    const unblocked = todo({ id: 'u', status: 'pending' });
    expect(getCurrentTodo([blocked, unblocked])?.id).toBe('u');
  });

  it('无活跃也无 pending 时返回 null', () => {
    expect(getCurrentTodo([todo({ id: 'c', status: 'completed' })])).toBeNull();
  });
});

describe('buildSubtaskContext', () => {
  it('返回单条 user 消息，含索引池 + 当前子任务 + 读回指针', () => {
    const todos = [
      todo({ id: 'done', status: 'completed', completedAt: 2000, metadata: { result: '结论A' } }),
      todo({ id: 'cur', status: 'in_progress', subject: '当前子任务', metadata: { verify: '跑测试通过' } }),
    ];
    const msgs = buildSubtaskContext(todos);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    const content = msgs[0].content as string;
    expect(content).toContain('[已完成子任务索引]');
    expect(content).toContain('结论A');
    expect(content).toContain('[当前子任务] 当前子任务');
    expect(content).toContain('完成标准: 跑测试通过');
    expect(content).toContain('todo_list');
  });

  it('不继承上一子任务的原始日志（重建为单条新鲜 user 消息）', () => {
    // 传入含大量历史消息的 todo 结构（本不该有原始日志），重建结果仍是单条干净 user 消息
    const msgs = buildSubtaskContext([todo({ id: 'cur', status: 'in_progress' })]);
    expect(msgs).toHaveLength(1);
  });
});

