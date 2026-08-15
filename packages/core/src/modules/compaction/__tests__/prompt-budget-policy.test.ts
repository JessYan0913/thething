import { describe, it, expect } from 'vitest';
import { deriveBudget, targetTokensFor, messageTargetTokensFor, MIN_MESSAGE_BUDGET_TOKENS, DEFAULT_TARGET_PERCENT, EMERGENCY_TARGET_PERCENT } from '../prompt-budget-policy';

describe('deriveBudget', () => {
  it('128k large window, unknown model (char level, 15% buffer)', () => {
    const p = deriveBudget(128_000, 8_000);
    expect(p.effectiveBudget).toBe(120_000);
    expect(p.bufferTokens).toBe(18_000); // 120k * 0.15
    // 窗口坐标系（含 outputReserve）：trigger = contextLimit − buffer
    expect(p.triggerTokens).toBe(110_000); // 128k − 18k
    expect(p.hardLimitTokens).toBe(125_000); // 128k − 3k
  });

  it('22.8k small window: buffer clamps to MIN_BUFFER (5000 for char)', () => {
    const p = deriveBudget(22_800, 8_000);
    expect(p.effectiveBudget).toBe(14_800);
    // floor(14800*0.15)=2220 < min 5000 → clamp 5000
    expect(p.bufferTokens).toBe(5_000);
    expect(p.triggerTokens).toBe(17_800); // 22.8k − 5k（窗口坐标）
    expect(p.hardLimitTokens).toBe(19_800); // 22.8k − 3k
  });

  it('exact encoding (gpt-4o) 128k: reaction space (10%) dominates over 4% error buffer', () => {
    const p = deriveBudget(128_000, 8_000, 'gpt-4o');
    // 误差 buffer 120k*0.04=4800，被反应空间 120k*0.1=12000 压过。
    // 触发时纯输入 = trigger − outputReserve = 116000 − 8000 = 108000 = effectiveBudget − buffer
    expect(p.bufferTokens).toBe(12_000);
    expect(p.triggerTokens).toBe(116_000); // 128k − 12k（窗口坐标）
    expect(p.hardLimitTokens).toBe(125_000); // 128k − 3k
  });

  it('exact encoding (gpt-4o) 200k: reaction space keeps trigger before the window', () => {
    const p = deriveBudget(200_000, 8_000, 'gpt-4o');
    expect(p.bufferTokens).toBe(19_200); // 192k * 0.1
    expect(p.triggerTokens).toBe(180_800); // 200k − 19.2k（窗口坐标）
    expect(p.triggerTokens).toBeLessThanOrEqual(p.hardLimitTokens);
  });

  it('approximate encoding (claude) 128k: 8% error buffer lifted to 10% reaction space', () => {
    const p = deriveBudget(128_000, 8_000, 'claude-opus-4-6');
    expect(p.bufferTokens).toBe(12_000); // 120k * 0.1 reaction > 120k*0.08 error
    expect(p.triggerTokens).toBe(116_000); // 128k − 12k（窗口坐标）
  });

  it('exact small window (22.8k): buffer floored at EMERGENCY_BUFFER, trigger never exceeds hard', () => {
    // 旧逻辑 buffer 被 min=2000 兜底 → trigger 12800 > hard 11800（红黄倒置）。
    // 下限抬到 EMERGENCY_BUFFER 后两者相切，shouldForce 不早于 shouldTrigger。
    const p = deriveBudget(22_800, 8_000, 'gpt-4o');
    expect(p.effectiveBudget).toBe(14_800);
    expect(p.bufferTokens).toBe(3_000);
    expect(p.triggerTokens).toBe(19_800); // 22.8k − 3k
    expect(p.hardLimitTokens).toBe(19_800); // 22.8k − 3k
    expect(p.triggerTokens).toBeLessThanOrEqual(p.hardLimitTokens);
  });

  it('tiny window: outputReserve eats the budget, no input space left', () => {
    const p = deriveBudget(4_000, 8_000);
    expect(p.effectiveBudget).toBe(0); // 输出预留已占满窗口
    // char 级 buffer=5000 超窗口 → trigger clamp 0；hard=1000。无输入空间 → 恒触发
    expect(p.triggerTokens).toBe(0);
    expect(p.hardLimitTokens).toBe(1_000); // 4k − 3k
    expect(p.triggerTokens).toBeLessThanOrEqual(p.hardLimitTokens);
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
