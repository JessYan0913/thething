import { describe, it, expect, beforeEach } from 'vitest';
import { estimateRequestBudget } from '../request-budget';
import { getEstimatorInfra, resetCalibration, recordUsageSample } from '../tokenizer';

// 清理校准状态，避免测试间污染
beforeEach(() => {
  getEstimatorInfra().calibrator.clear();
});

const smallMsgs = [{ role: 'user' as const, content: 'hello world' }];

describe('estimateRequestBudget', () => {
  it('cold start: no calibration buffer, total equals base total', async () => {
    const est = await estimateRequestBudget(smallMsgs, 'instructions', {}, 'unknown-model');
    expect(est.tokenizerBuffer).toBe(0);
    expect(est.totalTokensWithBuffer).toBe(est.totalTokens);
    expect(est.modelLimit).toBe(128_000);
    // 小请求远低于触发线
    expect(est.shouldTrigger).toBe(false);
    expect(est.shouldForce).toBe(false);
  });

  it('applies calibrated tokenizerBuffer once usage samples exist', async () => {
    // 制造 driftRatio 1.3：估算 base 1000，实际 1300
    recordUsageSample('unknown-model', 1000, 1300);
    const est = await estimateRequestBudget(smallMsgs, 'instructions', {}, 'unknown-model');
    const baseTokens = est.messagesTokens + est.instructionsTokens + est.toolsTokens;
    expect(est.tokenizerBuffer).toBe(Math.round(baseTokens * 0.3));
    expect(est.totalTokensWithBuffer).toBe(est.totalTokens + est.tokenizerBuffer);
  });

  it('exposes trigger/hardLimit from the single policy', async () => {
    const est = await estimateRequestBudget(smallMsgs, 'instructions', {}, 'unknown-model');
    expect(est.triggerTokens).toBe(102_000); // 128k - 8k output, char 15% buffer
    expect(est.hardLimitTokens).toBe(117_000);
    expect(est.shouldTrigger).toBe(false);
  });

  it('a large request near the window triggers', async () => {
    resetCalibration('unknown-model');
    // 构造一个占满窗口的消息（约 400k 字符 ≈ 100k tokens，char 估算 4 chars/token）
    const big = { role: 'user' as const, content: 'word '.repeat(80_000) };
    const est = await estimateRequestBudget([big], 'instructions', {}, 'unknown-model');
    expect(est.messagesTokens).toBeGreaterThan(90_000);
    // total ≈ 100k + outputReserve 8k ≥ trigger 102k → 触发
    expect(est.shouldTrigger).toBe(true);
  });

  it('proactive trigger: shouldTrigger true before the request actually exceeds the window', async () => {
    resetCalibration('unknown-model');
    // ~97.5k messages tokens + 8k outputReserve = ~105.5k total
    // ≥ trigger 102k（应主动升档）但 < 窗口 128k（未超限）
    const big = { role: 'user' as const, content: 'word '.repeat(78_000) };
    const est = await estimateRequestBudget([big], 'instructions', {}, 'unknown-model');
    expect(est.shouldTrigger).toBe(true);
    expect(est.exceedsLimit).toBe(false);
  });
});
