// ============================================================
// Context Budget Invariants - 4 个不变式测试
// ============================================================
// CI 必跑。任何失败 = 阻止 merge。
// 设计参考：docs/context-usage-redesign.md §9.1

import { describe, test, expect } from 'vitest';
import {
  CompactionStateTracker,
} from '../modules/compaction/state-tracker';
import {
  ContextBudgetSnapshotSchema,
  type ContextBudgetSnapshot,
} from '../services/context/budget-schema';

describe('CompactionStateTracker invariants', () => {
  test('INV-1: compactionsCount 单调非递减', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85 });
    t.tickStep(0);
    const s0 = t.getSnapshot();
    t.recordAttempt();
    t.recordResult(1000);
    t.tickStep(0);
    const s1 = t.getSnapshot();
    t.recordAttempt();
    t.recordResult(500);
    t.tickStep(1);
    const s2 = t.getSnapshot();

    expect(s1.compactionsCount).toBeGreaterThanOrEqual(s0.compactionsCount);
    expect(s2.compactionsCount).toBeGreaterThanOrEqual(s1.compactionsCount);
    expect(s1.compactionsCount).toBe(1);
    expect(s2.compactionsCount).toBe(2);
  });

  test('INV-2: totalFreed 单调非递减', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85 });
    t.tickStep(0);
    t.recordAttempt();
    t.recordResult(1000);
    t.tickStep(0);
    const s1 = t.getSnapshot();
    t.recordAttempt();
    t.recordResult(500);
    t.tickStep(1);
    const s2 = t.getSnapshot();
    expect(s2.totalFreed).toBe(s1.totalFreed + 500);
    expect(s2.totalFreed).toBe(1500);
  });

  test('INV-3: totalFreed === sum of per-step freed (no-op 算 0)', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85 });
    t.tickStep(0);
    t.recordAttempt();
    t.recordResult(1000);
    t.tickStep(0);
    t.recordAttempt();
    t.recordResult(500);
    t.tickStep(1);
    t.recordAttempt();
    t.recordResult(0);  // no-op
    t.tickStep(2);
    t.recordAttempt();
    t.recordResult(300);
    t.tickStep(3);
    expect(t.getSnapshot().totalFreed).toBe(1800);
    expect(t.getSnapshot().compactionsCount).toBe(3);  // 0-freed 不计次数
  });

  test('INV-4: state ∈ {idle, compacting, justCompacted}', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85 });
    const valid = new Set(['idle', 'compacting', 'justCompacted']);
    for (const step of [0, 1, 2, 3, 4, 5]) {
      t.tickStep(step);
      expect(valid.has(t.getSnapshot().state)).toBe(true);
    }
  });

  test('INV-5: justCompacted 1 步后自动回 idle', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85, justCompactedDurationSteps: 1 });
    t.tickStep(0);
    t.recordAttempt();
    t.recordResult(1000);
    t.tickStep(0);
    expect(t.getSnapshot().state).toBe('justCompacted');
    t.tickStep(1);
    // step 1 > step 0 + 1 → 自动回 idle
    expect(t.getSnapshot().state).toBe('idle');
  });

  test('INV-6: 拒绝非法 triggerPercent', () => {
    expect(() => new CompactionStateTracker({ triggerPercent: 1.5 })).toThrow();
    expect(() => new CompactionStateTracker({ triggerPercent: -0.1 })).toThrow();
  });

  test('INV-7: freed=0 走 no-op 分支，state 直接回 idle', () => {
    const t = new CompactionStateTracker({ triggerPercent: 0.85 });
    t.tickStep(0);
    t.recordAttempt();
    expect(t.getSnapshot().state).toBe('compacting');
    t.recordResult(0);
    expect(t.getSnapshot().state).toBe('idle');
    expect(t.getSnapshot().compactionsCount).toBe(0);
    expect(t.getSnapshot().totalFreed).toBe(0);
  });
});

describe('ContextBudgetSnapshot schema invariants', () => {
  const validSnapshot: ContextBudgetSnapshot = {
    utilizationPercent: 50,
    totalTokens: 1000,
    modelLimit: 2000,
    compaction: { state: 'idle', compactionsCount: 0, totalFreed: 0, triggerPercent: 0.85 },
    sessionCost: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, totalCostUsd: 0 },
    capturedAt: new Date().toISOString(),
    source: 'live',
  };

  test('INV-8: 合法 snapshot 通过 parse', () => {
    expect(() => ContextBudgetSnapshotSchema.parse(validSnapshot)).not.toThrow();
  });

  test('INV-9: utilizationPercent 越界 throw', () => {
    expect(() => ContextBudgetSnapshotSchema.parse({ ...validSnapshot, utilizationPercent: 150 })).toThrow();
    expect(() => ContextBudgetSnapshotSchema.parse({ ...validSnapshot, utilizationPercent: -10 })).toThrow();
  });

  test('INV-10: 非法 source throw', () => {
    expect(() => ContextBudgetSnapshotSchema.parse({ ...validSnapshot, source: 'unknown' })).toThrow();
  });

  test('INV-11: 非法 capturedAt throw', () => {
    expect(() => ContextBudgetSnapshotSchema.parse({ ...validSnapshot, capturedAt: 'not-a-date' })).toThrow();
  });

  test('INV-12: 缺字段 throw', () => {
    const { sessionCost, ...noCost } = validSnapshot;
    expect(() => ContextBudgetSnapshotSchema.parse(noCost)).toThrow();
  });
});
