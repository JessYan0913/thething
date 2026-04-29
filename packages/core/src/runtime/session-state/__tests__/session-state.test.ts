import { describe, it, expect, beforeEach } from 'vitest';
import type { LanguageModelUsage } from 'ai';
import type { CompactionResult } from '../../compaction/types';
import type { CostStore } from '../../../foundation/datastore/types';
import { TokenBudgetTracker } from '../token-budget';
import { CostTracker } from '../cost';
import { DEFAULT_PRICING } from '../../../foundation/model/pricing';

// ============================================================
// Helper: Mock CostStore
// ============================================================
function createMockCostStore(): CostStore {
  const records = new Map<string, ReturnType<CostStore['saveCostRecord']>>();
  return {
    saveCostRecord(params) {
      const record = {
        id: `cost-${Date.now()}`,
        conversationId: params.conversationId,
        model: params.model,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cachedReadTokens: params.cachedReadTokens,
        totalCostUsd: params.totalCostUsd,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      records.set(params.conversationId, record);
      return record;
    },
    getCostByConversation(conversationId: string) {
      return records.get(conversationId) ?? null;
    },
    updateCostByConversation(conversationId: string, params: {
      inputTokens: number;
      outputTokens: number;
      cachedReadTokens: number;
      totalCostUsd: number;
    }) {
      const record = records.get(conversationId);
      if (record) {
        record.inputTokens = params.inputTokens;
        record.outputTokens = params.outputTokens;
        record.cachedReadTokens = params.cachedReadTokens;
        record.totalCostUsd = params.totalCostUsd;
        record.updatedAt = new Date().toISOString();
      }
    },
  };
}

// ============================================================
// Helper: Create valid LanguageModelUsage object
// ============================================================
function createUsage(options: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}): LanguageModelUsage {
  return {
    inputTokens: options.inputTokens ?? 0,
    outputTokens: options.outputTokens ?? 0,
    totalTokens: (options.inputTokens ?? 0) + (options.outputTokens ?? 0),
    cachedInputTokens: options.cachedInputTokens ?? 0,
    inputTokenDetails: {},
    outputTokenDetails: {},
  } as LanguageModelUsage;
}

// ============================================================
// Token Budget Tracker Tests
// ============================================================
describe('token-budget', () => {
  describe('TokenBudgetTracker', () => {
    let tracker: TokenBudgetTracker;

    beforeEach(() => {
      tracker = new TokenBudgetTracker(128_000, 25_000);
    });

    describe('constructor', () => {
      it('should initialize with default values', () => {
        expect(tracker.inputTokens).toBe(0);
        expect(tracker.outputTokens).toBe(0);
        expect(tracker.totalTokens).toBe(0);
        expect(tracker.remainingTokens).toBe(128_000);
      });
    });

    describe('accumulate', () => {
      it('should accumulate input tokens', () => {
        tracker.accumulate(createUsage({ inputTokens: 1000 }));
        expect(tracker.inputTokens).toBe(1000);
      });

      it('should accumulate output tokens', () => {
        tracker.accumulate(createUsage({ outputTokens: 500 }));
        expect(tracker.outputTokens).toBe(500);
      });

      it('should accumulate cached tokens', () => {
        tracker.accumulate(createUsage({ cachedInputTokens: 200 }));
        expect(tracker.cachedReadTokens).toBe(200);
      });

      it('should accumulate all tokens together', () => {
        tracker.accumulate(createUsage({
          inputTokens: 1000,
          outputTokens: 500,
          cachedInputTokens: 200,
        }));
        expect(tracker.inputTokens).toBe(1000);
        expect(tracker.outputTokens).toBe(500);
        expect(tracker.cachedReadTokens).toBe(200);
        expect(tracker.totalTokens).toBe(1500);
      });
    });

    describe('totalTokens', () => {
      it('should return sum of input and output tokens', () => {
        tracker.accumulate(createUsage({ inputTokens: 5000, outputTokens: 3000 }));
        expect(tracker.totalTokens).toBe(8000);
      });
    });

    describe('remainingTokens', () => {
      it('should calculate remaining tokens', () => {
        tracker.accumulate(createUsage({ inputTokens: 5000, outputTokens: 3000 }));
        expect(tracker.remainingTokens).toBe(128_000 - 8000);
      });
    });

    describe('usagePercentage', () => {
      it('should calculate usage percentage', () => {
        tracker.accumulate(createUsage({ inputTokens: 64000, outputTokens: 0 }));
        expect(tracker.usagePercentage).toBe(50);
      });
    });

    describe('shouldCompact', () => {
      it('should return false when under threshold', () => {
        tracker.accumulate(createUsage({ inputTokens: 10000, outputTokens: 5000 }));
        expect(tracker.shouldCompact()).toBe(false);
      });

      it('should return true when approaching limit', () => {
        // 128_000 - 25_000 = 103_000 threshold
        tracker.accumulate(createUsage({ inputTokens: 110000, outputTokens: 0 }));
        expect(tracker.shouldCompact()).toBe(true);
      });
    });

    describe('reportCompaction', () => {
      it('should record tokens freed', () => {
        tracker.accumulate(createUsage({ inputTokens: 50000, outputTokens: 10000 }));
        const result: CompactionResult = {
          messages: [],
          executed: true,
          type: 'auto',
          tokensFreed: 20000,
        };
        tracker.reportCompaction(result);
        expect(tracker.inputTokens).toBe(30000);
      });

      it('should not go below zero', () => {
        tracker.accumulate(createUsage({ inputTokens: 5000, outputTokens: 1000 }));
        const result: CompactionResult = {
          messages: [],
          executed: true,
          type: 'auto',
          tokensFreed: 10000,
        };
        tracker.reportCompaction(result);
        expect(tracker.inputTokens).toBe(0);
      });
    });

    describe('finalize', () => {
      it('should accumulate final usage', () => {
        tracker.accumulate(createUsage({ inputTokens: 5000 }));
        tracker.finalize(createUsage({ inputTokens: 3000, outputTokens: 1000 }));
        expect(tracker.inputTokens).toBe(8000);
        expect(tracker.outputTokens).toBe(1000);
      });
    });

    describe('getSummary', () => {
      it('should return complete summary', () => {
        tracker.accumulate(createUsage({ inputTokens: 50000, outputTokens: 10000, cachedInputTokens: 5000 }));
        const summary = tracker.getSummary();
        expect(summary.inputTokens).toBe(50000);
        expect(summary.outputTokens).toBe(10000);
        expect(summary.cachedReadTokens).toBe(5000);
        expect(summary.totalTokens).toBe(60000);
        expect(summary.remainingTokens).toBe(128_000 - 60000);
        expect(summary.usagePercentage).toBeCloseTo(46.88, 1);
        expect(summary.shouldCompact).toBe(false);
      });
    });
  });
});

// ============================================================
// Cost Tracker Tests
// ============================================================
describe('cost', () => {
  describe('DEFAULT_PRICING', () => {
    it('should have pricing for qwen-max', () => {
      expect(DEFAULT_PRICING['qwen-max']).toBeDefined();
      expect(DEFAULT_PRICING['qwen-max'].input).toBe(4);
      expect(DEFAULT_PRICING['qwen-max'].output).toBe(12);
    });

    it('should have pricing for qwen-plus', () => {
      expect(DEFAULT_PRICING['qwen-plus']).toBeDefined();
      expect(DEFAULT_PRICING['qwen-plus'].input).toBe(1.5);
    });

    it('should have pricing for deepseek-v3', () => {
      expect(DEFAULT_PRICING['deepseek-v3']).toBeDefined();
    });
  });

  describe('CostTracker', () => {
    let tracker: CostTracker;

    beforeEach(() => {
      tracker = new CostTracker('test-conv-1', createMockCostStore(), { model: 'qwen-max', maxBudgetUsd: 5.0 });
    });

    describe('constructor', () => {
      it('should initialize with correct values', () => {
        expect(tracker.totalCost).toBe(0);
        expect(tracker.inputTokens).toBe(0);
        expect(tracker.outputTokens).toBe(0);
        expect(tracker.isOverBudget).toBe(false);
        expect(tracker.remainingBudget).toBe(5.0);
      });
    });

    describe('calculateDelta', () => {
      it('should calculate cost delta for qwen-max', () => {
        const delta = tracker.calculateDelta(100_000, 50_000, 10_000);
        // input: 100K * 4 / 1M = 0.4
        // output: 50K * 12 / 1M = 0.6
        // cached: 10K * 1 / 1M = 0.01
        expect(delta.inputCost).toBeCloseTo(0.4, 2);
        expect(delta.outputCost).toBeCloseTo(0.6, 2);
        expect(delta.cachedCost).toBeCloseTo(0.01, 2);
        expect(delta.totalCost).toBeCloseTo(1.01, 2);
      });

      it('should use default pricing for unknown model', () => {
        const unknownTracker = new CostTracker('test-conv', createMockCostStore(), { model: 'unknown-model' });
        const delta = unknownTracker.calculateDelta(100_000, 50_000, 0);
        // default pricing: input 1.5, output 4.5
        expect(delta.inputCost).toBeCloseTo(0.15, 2);
        expect(delta.outputCost).toBeCloseTo(0.225, 2);
      });
    });

    describe('accumulate', () => {
      it('should accumulate cost delta', () => {
        const delta = tracker.calculateDelta(100_000, 50_000, 0);
        tracker.accumulate(delta);
        expect(tracker.totalCost).toBeCloseTo(delta.totalCost, 2);
        expect(tracker.inputTokens).toBe(100_000);
        expect(tracker.outputTokens).toBe(50_000);
      });

      it('should accumulate multiple deltas', () => {
        tracker.accumulate(tracker.calculateDelta(50_000, 25_000, 0));
        tracker.accumulate(tracker.calculateDelta(50_000, 25_000, 0));
        expect(tracker.inputTokens).toBe(100_000);
        expect(tracker.outputTokens).toBe(50_000);
      });
    });

    describe('accumulateFromUsage', () => {
      it('should calculate and accumulate in one call', () => {
        const delta = tracker.accumulateFromUsage(100_000, 50_000, 0);
        expect(tracker.totalCost).toBeCloseTo(delta.totalCost, 2);
      });
    });

    describe('isOverBudget', () => {
      it('should return false when under budget', () => {
        tracker.accumulateFromUsage(100_000, 50_000, 0);
        expect(tracker.isOverBudget).toBe(false);
      });

      it('should return true when over budget', () => {
        // Accumulate enough to exceed 5.0 budget
        tracker.accumulateFromUsage(1_000_000, 500_000, 0);
        expect(tracker.isOverBudget).toBe(true);
      });
    });

    describe('remainingBudget', () => {
      it('should return remaining budget', () => {
        tracker.accumulateFromUsage(100_000, 50_000, 0);
        expect(tracker.remainingBudget).toBeCloseTo(5.0 - tracker.totalCost, 2);
      });

      it('should return 0 when over budget', () => {
        tracker.accumulateFromUsage(2_000_000, 1_000_000, 0);
        expect(tracker.remainingBudget).toBe(0);
      });
    });

    describe('getSummary', () => {
      it('should return complete summary', () => {
        tracker.accumulateFromUsage(100_000, 50_000, 10_000);
        const summary = tracker.getSummary();
        expect(summary.inputTokens).toBe(100_000);
        expect(summary.outputTokens).toBe(50_000);
        expect(summary.cachedReadTokens).toBe(10_000);
        expect(summary.maxBudgetUsd).toBe(5.0);
        expect(summary.isOverBudget).toBe(false);
        expect(summary.budgetUsagePercent).toBeCloseTo(tracker.totalCost / 5.0 * 100, 1);
      });
    });
  });
});