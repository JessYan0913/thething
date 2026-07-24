import { describe, it, expect } from 'vitest';
import { gateFromEstimation } from '../gate';
import type { FullRequestEstimation } from '../token-counter';

// ============================================================
// gateFromEstimation - 闸门纯函数
// ============================================================
// P1: 从已有估算判定闸门,供 prepareStep 复用 context bar 估算(零新增开销)。
// REJECT -> 调用方抛 CONTEXT_BUDGET_EXCEEDED: <decision>。

function est(overrides: Partial<FullRequestEstimation>): FullRequestEstimation {
  return {
    totalTokens: 0,
    messagesTokens: 0,
    instructionsTokens: 0,
    toolsTokens: 0,
    outputReserve: 0,
    availableBudget: 0,
    modelLimit: 100000,
    exceedsLimit: false,
    utilizationPercent: 0,
    tokenizerVersion: 'char-estimation',
    ...overrides,
  };
}

describe('gateFromEstimation', () => {
  it('under limit -> PASS', () => {
    const r = gateFromEstimation(
      est({
        totalTokens: 50000,
        messagesTokens: 40000,
        instructionsTokens: 5000,
        toolsTokens: 3000,
        outputReserve: 2000,
        modelLimit: 100000,
        exceedsLimit: false,
        utilizationPercent: 50,
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.decision).toMatch(/^PASS/);
  });

  it('over limit -> REJECT with breakdown', () => {
    const r = gateFromEstimation(
      est({
        totalTokens: 120000,
        messagesTokens: 100000,
        instructionsTokens: 8000,
        toolsTokens: 5000,
        outputReserve: 7000,
        modelLimit: 100000,
        exceedsLimit: true,
        utilizationPercent: 120,
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toMatch(/^REJECT/);
    // breakdown 记录各分项,413 时定位哪部分撑爆
    expect(r.breakdown.messages).toBe(100000);
    expect(r.breakdown.instructions).toBe(8000);
    expect(r.breakdown.tools).toBe(5000);
    expect(r.breakdown.outputReserve).toBe(7000);
    expect(r.decision).toContain('120000');
    expect(r.decision).toContain('100000');
  });

  it('high utilization (within limit) -> WARN', () => {
    const r = gateFromEstimation(
      est({
        totalTokens: 85000,
        modelLimit: 100000,
        exceedsLimit: false,
        utilizationPercent: 85,
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.decision).toMatch(/^WARN/);
  });

  it('REJECT decision 可直接拼成 CONTEXT_BUDGET_EXCEEDED', () => {
    // P1: prepareStep 复用估算,REJECT -> throw `CONTEXT_BUDGET_EXCEEDED: ${decision}`
    const r = gateFromEstimation(
      est({
        totalTokens: 200000,
        messagesTokens: 180000,
        modelLimit: 100000,
        exceedsLimit: true,
        utilizationPercent: 200,
      }),
    );
    expect(r.passed).toBe(false);
    const thrown = `CONTEXT_BUDGET_EXCEEDED: ${r.decision}`;
    expect(thrown.startsWith('CONTEXT_BUDGET_EXCEEDED: REJECT')).toBe(true);
  });
});
