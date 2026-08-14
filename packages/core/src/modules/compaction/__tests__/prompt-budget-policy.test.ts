import { describe, it, expect } from 'vitest';
import { deriveBudget, targetTokensFor, messageTargetTokensFor, MIN_MESSAGE_BUDGET_TOKENS, DEFAULT_TARGET_PERCENT, EMERGENCY_TARGET_PERCENT } from '../prompt-budget-policy';

describe('deriveBudget', () => {
  it('128k large window, unknown model (char level, 15% buffer)', () => {
    const p = deriveBudget(128_000, 8_000);
    expect(p.effectiveBudget).toBe(120_000);
    expect(p.bufferTokens).toBe(18_000); // 120k * 0.15
    expect(p.triggerTokens).toBe(102_000);
    expect(p.hardLimitTokens).toBe(117_000);
  });

  it('22.8k small window: buffer clamps to MIN_BUFFER (5000 for char)', () => {
    const p = deriveBudget(22_800, 8_000);
    expect(p.effectiveBudget).toBe(14_800);
    // floor(14800*0.15)=2220 < min 5000 → clamp 5000
    expect(p.bufferTokens).toBe(5_000);
    expect(p.triggerTokens).toBe(9_800);
    expect(p.hardLimitTokens).toBe(11_800);
  });

  it('exact encoding (gpt-4o) uses 4% buffer with min 2000', () => {
    const p = deriveBudget(128_000, 8_000, 'gpt-4o');
    expect(p.bufferTokens).toBe(4_800); // 120k * 0.04
    expect(p.triggerTokens).toBe(115_200);
  });

  it('approximate encoding (claude) uses 8% buffer with min 3000', () => {
    const p = deriveBudget(128_000, 8_000, 'claude-opus-4-6');
    expect(p.bufferTokens).toBe(9_600); // 120k * 0.08
    expect(p.triggerTokens).toBe(110_400);
  });

  it('tiny window never goes negative', () => {
    const p = deriveBudget(4_000, 8_000);
    expect(p.effectiveBudget).toBe(0);
    expect(p.triggerTokens).toBe(0);
    expect(p.hardLimitTokens).toBe(0);
  });

  it('1M window caps buffer at MAX_BUFFER (50k)', () => {
    const p = deriveBudget(1_000_000, 8_000, 'gpt-4o');
    // floor(992000*0.04) = 39680 < 50k → no cap needed; but char 15% would be 148800 > 50k
    const q = deriveBudget(1_000_000, 8_000);
    expect(q.bufferTokens).toBe(50_000);
    expect(p.bufferTokens).toBe(39_680);
  });
});

describe('targetTokensFor', () => {
  it('defaults to 70% of contextLimit', () => {
    expect(targetTokensFor(128_000)).toBe(89_600);
  });

  it('emergency target is 60%', () => {
    expect(targetTokensFor(128_000, EMERGENCY_TARGET_PERCENT)).toBe(76_800);
  });

  it('constants are consistent', () => {
    expect(DEFAULT_TARGET_PERCENT).toBe(0.7);
    expect(EMERGENCY_TARGET_PERCENT).toBe(0.6);
  });
});

describe('messageTargetTokensFor', () => {
  it('subtracts fixed overhead from the target request', () => {
    expect(messageTargetTokensFor(76_800, 18_000)).toBe(58_800);
  });

  it('floors at MIN_MESSAGE_BUDGET_TOKENS when overhead eats the budget (22.8k small window)', () => {
    // limit 22.8k × 0.6 = 13.68k 目标请求，固定开销 18.2k → 原始预算为负 → 触底 2000
    expect(messageTargetTokensFor(13_680, 18_200)).toBe(2000);
  });

  it('MIN_MESSAGE_BUDGET_TOKENS is 2000', () => {
    expect(MIN_MESSAGE_BUDGET_TOKENS).toBe(2000);
  });
});
