import { describe, it, expect } from 'vitest';
import {
  determineRunStatus,
  deriveStopReason,
  finalizeRun,
  downgradeUnsettledInProgress,
  type StopReason,
  type RunFinalizationState,
} from '../run-finalization';
import type { Todo } from '../../todos/types';

describe('determineRunStatus', () => {
  it('maps done/quiescent to completed', () => {
    expect(determineRunStatus('done')).toBe('completed');
    expect(determineRunStatus('quiescent')).toBe('completed');
  });

  it('maps all resource/control stops to exhausted', () => {
    const stops: StopReason[] = [
      'step_limit',
      'cost_budget',
      'context_budget',
      'denial_limit',
      'goal_budget',
      'goal_max_turns',
      'goal_blocked',
      'aborted',
      'budget_exception',
    ];
    for (const s of stops) expect(determineRunStatus(s)).toBe('exhausted');
  });

  it('maps truncation/error to failed', () => {
    expect(determineRunStatus('output_truncated')).toBe('failed');
    expect(determineRunStatus('error')).toBe('failed');
  });
});

describe('deriveStopReason (pure)', () => {
  const base = {
    aborted: false,
    turnCount: 0,
    maxSteps: 50,
    truncated: false,
    overBudget: false,
    denialExceeded: false,
    goalState: null,
  };

  it('defaults to done', () => {
    expect(deriveStopReason(base)).toBe('done');
  });

  it('forcedReason takes precedence over everything', () => {
    expect(
      deriveStopReason({ ...base, forcedReason: 'budget_exception', turnCount: 99, aborted: true }),
    ).toBe('budget_exception');
  });

  it('exhaustedHint comes before state derivation', () => {
    expect(deriveStopReason({ ...base, exhaustedHint: 'context_budget' })).toBe('context_budget');
    expect(deriveStopReason({ ...base, exhaustedHint: 'step_limit', turnCount: 99 })).toBe('step_limit');
  });

  it('exhaustFlag=context_budget → context_budget（闸门受控终止）', () => {
    expect(deriveStopReason({ ...base, exhaustFlag: 'context_budget' })).toBe('context_budget');
    expect(deriveStopReason({ ...base, exhaustFlag: 'context_budget', turnCount: 99, aborted: true })).toBe('context_budget');
  });

  it('derives step_limit / cost_budget / denial / aborted / truncated', () => {
    expect(deriveStopReason({ ...base, turnCount: 50 })).toBe('step_limit');
    expect(deriveStopReason({ ...base, overBudget: true })).toBe('cost_budget');
    expect(deriveStopReason({ ...base, denialExceeded: true })).toBe('denial_limit');
    expect(deriveStopReason({ ...base, aborted: true })).toBe('aborted');
    expect(deriveStopReason({ ...base, truncated: true })).toBe('output_truncated');
  });

  it('derives goal states', () => {
    expect(deriveStopReason({ ...base, goalState: { status: 'budget_limited' } as never })).toBe('goal_budget');
    expect(deriveStopReason({ ...base, goalState: { status: 'max_turns' } as never })).toBe('goal_max_turns');
    expect(deriveStopReason({ ...base, goalState: { status: 'blocked' } as never })).toBe('goal_blocked');
    expect(deriveStopReason({ ...base, goalState: { status: 'active' } as never })).toBe('done');
  });
});

function makeFakeStore() {
  const calls: Array<{ kind: string; conversationId: string; payload?: unknown }> = [];
  const todos: Todo[] = [];
  const agentRunStore = {
    completeRun: (c: string) => calls.push({ kind: 'complete', conversationId: c }),
    exhaustRun: (c: string, reason: string) => calls.push({ kind: 'exhausted', conversationId: c, payload: reason }),
    failRun: (c: string, error: string) => calls.push({ kind: 'failed', conversationId: c, payload: error }),
  };
  const todoStore = {
    getTodosByConversation: (_conv: string) => todos,
    updateTodo: (input: Partial<Todo> & { id: string }) => {
      const idx = todos.findIndex((t) => t.id === input.id);
      if (idx === -1) return undefined;
      todos[idx] = { ...todos[idx], ...input } as Todo;
      return todos[idx];
    },
    // 供 setTodo 用
    push: (t: Todo) => todos.push(t),
  };
  const dataStore = { agentRunStore, todoStore } as never;
  return { dataStore, calls, todos, todoStore, push: (t: Todo) => todos.push(t) };
}

const baseState: RunFinalizationState = {
  turnCount: 0,
  aborted: false,
  costTracker: { isOverBudget: false },
  denialTracker: { isThresholdExceeded: () => false },
  goalState: null,
};

function makeTodo(partial: Partial<Todo>): Todo {
  return {
    id: 't1',
    conversationId: 'c1',
    subject: 'task',
    status: 'pending',
    createdAt: 0,
    updatedAt: 0,
    order: 0,
    blockedBy: [],
    metadata: {},
    ...partial,
  } as Todo;
}

describe('finalizeRun', () => {
  it('completes when none of the abort conditions hold', async () => {
    const { dataStore, calls } = makeFakeStore();
    const r = await finalizeRun({ dataStore, conversationId: 'c1', sessionState: baseState, maxSteps: 50 });
    expect(r.status).toBe('completed');
    expect(r.reason).toBe('done');
    expect(calls).toEqual([{ kind: 'complete', conversationId: 'c1' }]);
  });

  it('marks exhausted + step_limit when turnCount >= maxSteps', async () => {
    const { dataStore, calls } = makeFakeStore();
    const r = await finalizeRun({
      dataStore,
      conversationId: 'c1',
      sessionState: { ...baseState, turnCount: 50 },
      maxSteps: 50,
    });
    expect(r.status).toBe('exhausted');
    expect(r.reason).toBe('step_limit');
    expect(calls).toEqual([{ kind: 'exhausted', conversationId: 'c1', payload: 'step_limit' }]);
  });

  it('marks exhausted + context_budget via exhaustedHint', async () => {
    const { dataStore, calls } = makeFakeStore();
    const r = await finalizeRun({
      dataStore,
      conversationId: 'c1',
      sessionState: { ...baseState, exhaustedHint: 'context_budget' },
      maxSteps: 50,
    });
    expect(r.reason).toBe('context_budget');
    expect(r.status).toBe('exhausted');
    expect(calls[0]).toEqual({ kind: 'exhausted', conversationId: 'c1', payload: 'context_budget' });
  });

  it('marks exhausted + aborted when aborted', async () => {
    const { dataStore, calls } = makeFakeStore();
    const r = await finalizeRun({
      dataStore,
      conversationId: 'c1',
      sessionState: { ...baseState, aborted: true },
      maxSteps: 50,
    });
    expect(r.reason).toBe('aborted');
    expect(r.status).toBe('exhausted');
  });

  it('marks failed + output_truncated when truncated', async () => {
    const { dataStore, calls } = makeFakeStore();
    const r = await finalizeRun({ dataStore, conversationId: 'c1', sessionState: baseState, maxSteps: 50, truncated: true });
    expect(r.reason).toBe('output_truncated');
    expect(r.status).toBe('failed');
    expect(calls[0].kind).toBe('failed');
  });

  it('machine-downgrades unsettled in_progress todos to pending with interrupted metadata', async () => {
    const { dataStore, calls, todoStore, push } = makeFakeStore();
    push(makeTodo({ id: 'a', status: 'in_progress', claimedBy: 'main' }));
    push(makeTodo({ id: 'b', status: 'pending' }));
    const r = await finalizeRun({ dataStore, conversationId: 'c1', sessionState: baseState, maxSteps: 50 });
    const a = todoStore.getTodosByConversation('c1')[0];
    expect(a.status).toBe('pending');
    expect(a.claimedBy).toBeNull(); // T4：回卷后清 claimedBy，可再次 claim
    const exec = a.metadata.execution as { interruptedReason?: string; interruptedAt?: number } | undefined;
    expect(exec?.interruptedReason).toBe('done');
    expect(typeof exec?.interruptedAt).toBe('number');
    const b = todoStore.getTodosByConversation('c1')[1];
    expect(b.status).toBe('pending'); // not touched
    expect(r.downgraded).toBe(1);
    expect(calls).toEqual([{ kind: 'complete', conversationId: 'c1' }]);
  });

  it('invokes pushTodoUpdate when a downgrade happened', async () => {
    const { dataStore, push } = makeFakeStore();
    push(makeTodo({ id: 'a', status: 'in_progress' }));
    let pushed: Todo[] | null = null;
    await finalizeRun({
      dataStore,
      conversationId: 'c1',
      sessionState: baseState,
      maxSteps: 50,
      pushTodoUpdate: (todos) => { pushed = todos; },
    });
    expect(pushed).not.toBeNull();
    expect(pushed!.every((t) => t.status !== 'in_progress')).toBe(true);
  });

  it('does not invoke pushTodoUpdate when nothing was downgraded', async () => {
    const { dataStore, push } = makeFakeStore();
    push(makeTodo({ id: 'a', status: 'completed' }));
    let pushed = false;
    await finalizeRun({
      dataStore,
      conversationId: 'c1',
      sessionState: baseState,
      maxSteps: 50,
      pushTodoUpdate: () => { pushed = true; },
    });
    expect(pushed).toBe(false);
  });
});

describe('downgradeUnsettledInProgress', () => {
  it('is a pure deterministic function (no run guard, same call can run twice harmlessly)', () => {
    const { dataStore, push } = makeFakeStore();
    push(makeTodo({ id: 'a', status: 'in_progress' }));
    const first = downgradeUnsettledInProgress(dataStore, 'c1', 'step_limit');
    const second = downgradeUnsettledInProgress(dataStore, 'c1', 'aborted');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // already pending → no-op, not double-counted
  });
});