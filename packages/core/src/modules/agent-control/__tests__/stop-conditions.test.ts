import { describe, it, expect } from 'vitest';
import { stopOnTruncatedToolBatch, createDefaultStopConditions } from '../stop-conditions';
import type { CostTracking } from '../../session/interfaces';

function fakeCost(): CostTracking {
  return { isOverBudget: false } as unknown as CostTracking;
}

function step(finishReason: string, toolCalls: unknown[] = []) {
  return { finishReason, toolCalls } as any;
}

describe('stopOnTruncatedToolBatch (pi 截断批次毒化)', () => {
  it('length 收尾且含工具调用 → 停推', () => {
    const cond = stopOnTruncatedToolBatch();
    expect(cond({ steps: [step('length', [{ toolCallId: '1' }])] } as any)).toBe(true);
  });

  it('length 且纯文本 → 不停推（文本截断交由 run 终态 output_truncated / auto-retry）', () => {
    const cond = stopOnTruncatedToolBatch();
    expect(cond({ steps: [step('length')] } as any)).toBe(false);
  });

  it('stop / tool-calls / 无步 → 不停推', () => {
    const cond = stopOnTruncatedToolBatch();
    expect(cond({ steps: [step('stop', [{ toolCallId: '1' }])] } as any)).toBe(false);
    expect(cond({ steps: [step('tool-calls', [{ toolCallId: '1' }])] } as any)).toBe(false);
    expect(cond({ steps: [] } as any)).toBe(false);
  });
});

describe('createDefaultStopConditions', () => {
  it('默认集合内必有条件对 length+工具调用样本返回 true（截断批次停推生效）', () => {
    const conds = createDefaultStopConditions(fakeCost());
    // 样本下 isStepCount(50)/costBudget/denial/hasToolCall('done') 均为 false，
    // 只有截断批次守卫为 true——任一条件 true 即停推
    const fired = conds.some((c) => c({ steps: [step('length', [{ toolCallId: '1' }])] } as any));
    expect(fired).toBe(true);
  });

  it('普通 stop 收尾的步不触发任意默认条件', () => {
    const conds = createDefaultStopConditions(fakeCost());
    const fired = conds.some((c) => c({ steps: [step('stop', [{ toolCallId: '1' }])] } as any));
    expect(fired).toBe(false);
  });
});