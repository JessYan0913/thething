import { describe, it, expect } from 'vitest';
import { buildCompletionAuditPrompt, type AuditDecision } from '../completion-audit';
import type { TodoRuntimeState } from '../../todos/todo-runtime';

function runtime(over: Partial<TodoRuntimeState> = {}): TodoRuntimeState {
  return {
    ready: [],
    inProgress: [],
    pending: [],
    blocked: [],
    failed: [],
    completed: [],
    cancelled: [],
    pendingArchiveIds: [],
    pendingRetryIds: [],
    quiescent: true,
    quiescenceReason: null,
    ...over,
  };
}

const todo = (subject: string, extra: Partial<TodoRuntimeState['completed'][number]> = {}) => ({
  id: 'x',
  subject,
  status: 'completed' as const,
  ...extra,
});

describe('buildCompletionAuditPrompt', () => {
  it('空状态也渲染 quiescent 提示（系统只陈述事实）', () => {
    const p = buildCompletionAuditPrompt(runtime());
    expect(p).toContain('系统当前没有正在运行的待办工作');
    expect(p).toContain('- complete：');
    expect(p).toContain('- continue：');
    expect(p).toContain('- blocked：');
    expect(p).toContain('- replan：');
    expect(p).toContain('- needs_user：');
  });

  it('quiescenceReason 注入表头原因', () => {
    const p = buildCompletionAuditPrompt(runtime({ quiescenceReason: 'blocked' }));
    expect(p).toContain('原因：被依赖阻塞');
    const p2 = buildCompletionAuditPrompt(runtime({ quiescenceReason: 'completed_candidate' }));
    expect(p2).toContain('原因：多为已完成、可作完成判断');
  });

  it('注入 Goal 时首段呈现 objective', () => {
    const p = buildCompletionAuditPrompt(runtime(), '完成登录页');
    expect(p.startsWith('## Goal\n完成登录页')).toBe(true);
  });

  it('渲染 pending(含阻塞)/failed/cancelled 列表为 markdown', () => {
    // blocked 是 pending 的派生子集，故一个被阻塞任务同时出现在 pending 里
    const p = buildCompletionAuditPrompt(runtime({
      pending: [todo('P1'), todo('B1')] as TodoRuntimeState['pending'],
      blocked: [todo('B1')] as TodoRuntimeState['blocked'],
      failed: [todo('F1')] as TodoRuntimeState['failed'],
      cancelled: [todo('C1')] as TodoRuntimeState['cancelled'],
    }));
    expect(p).toContain('### Pending（含被依赖阻塞）\n- P1\n- B1');
    expect(p).toContain('### Failed\n- F1');
    expect(p).toContain('### Cancelled\n- C1');
  });

  it('completed 摘要取 facts.conclusion 优先、result 次之、截断 50 字', () => {
    const p = buildCompletionAuditPrompt(runtime({
      completed: [
        todo('A', { metadata: { result: '长结果'.repeat(100) } }),
        todo('B', { metadata: { facts: { conclusion: '事实结论' }, result: '结果' } }),
      ] as TodoRuntimeState['completed'],
    }));
    // 截断到 50 字符后补 `…`（「长结果…」重复 16 次 ≈ 48 字符 + 2 截断）
    // 长 result 被截断到 50 字符并补 `…`
    expect(p).toMatch(/### Recent Completed\n- A：长结果长结果.+…/);
    expect(p).toMatch(/- B：事实结论/);
  });

  it('decision 类型是完备的 5 元组（编译期哨兵）', () => {
    const decisions: AuditDecision[] = ['complete', 'continue', 'blocked', 'replan', 'needs_user'];
    expect(decisions).toHaveLength(5);
  });
});
