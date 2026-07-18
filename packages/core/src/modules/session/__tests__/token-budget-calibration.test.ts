import { describe, it, expect } from 'vitest';
import { TokenBudgetTracker } from '../token-budget';

// ============================================================
// 8.2 usage 反馈校准 token 估算
// 见 docs/compaction-execution-plan.md 步骤 8.2
// ============================================================

function usage(inputTokens: number) {
  return { inputTokens, outputTokens: 0 } as any;
}

describe('TokenBudgetTracker usage calibration', () => {
  it('starts at calibration 1', () => {
    const t = new TokenBudgetTracker();
    expect(t.calibration).toBe(1);
  });

  it('moves calibration toward the actual/estimate ratio (EMA)', () => {
    const t = new TokenBudgetTracker();
    // 估算 1000,真实 1500 → ratio 1.5,EMA(alpha=0.3): 1*0.7 + 1.5*0.3 = 1.15
    t.recordEstimate(1000);
    t.accumulate(usage(1500));
    expect(t.calibration).toBeCloseTo(1.15, 5);
  });

  it('converges toward a persistent under-estimate over several steps', () => {
    const t = new TokenBudgetTracker();
    // 持续低估一倍(真实是估算的 2 倍)
    for (let i = 0; i < 10; i++) {
      t.recordEstimate(1000);
      t.accumulate(usage(2000));
    }
    // 应向上收敛,接近但不超过 clamp 上限 2
    expect(t.calibration).toBeGreaterThan(1.6);
    expect(t.calibration).toBeLessThanOrEqual(2);
  });

  it('clamps extreme ratios to [0.5, 2]', () => {
    const t = new TokenBudgetTracker();
    // 真实是估算的 100 倍(异常样本)→ 单步 ratio 被夹到 2
    t.recordEstimate(10);
    t.accumulate(usage(1000));
    // EMA: 1*0.7 + 2*0.3 = 1.3(而非 1 + 100*0.3)
    expect(t.calibration).toBeCloseTo(1.3, 5);
  });

  it('does not calibrate without a pending estimate', () => {
    const t = new TokenBudgetTracker();
    t.accumulate(usage(5000)); // 没有先 recordEstimate
    expect(t.calibration).toBe(1);
  });

  it('does not calibrate on zero actual input tokens', () => {
    const t = new TokenBudgetTracker();
    t.recordEstimate(1000);
    t.accumulate(usage(0));
    expect(t.calibration).toBe(1);
  });

  it('consumes the pending estimate after one accumulate (no stale reuse)', () => {
    const t = new TokenBudgetTracker();
    t.recordEstimate(1000);
    t.accumulate(usage(1500)); // → 1.15
    const afterFirst = t.calibration;
    t.accumulate(usage(1500)); // 无新 estimate,不应再变
    expect(t.calibration).toBe(afterFirst);
  });
});
