import { describe, it, expect, vi } from 'vitest';
import { costTrackingMiddleware } from '../cost-tracking';
import { CostTracker } from '../../session/cost';
import type { CostStore } from '../../../primitives/datastore/types';

function createMockCostStore(): CostStore {
  return {
    saveCostRecord: vi.fn().mockResolvedValue(undefined),
    getCostByConversation: vi.fn().mockResolvedValue(null),
    updateCostByConversation: vi.fn().mockResolvedValue(undefined),
  };
}

function createTracker(): CostTracker {
  return new CostTracker('conv-1', createMockCostStore(), {
    model: 'test-model',
    pricingResolver: { getModelPricing: () => ({ input: 1, output: 2, cached: 0.5 }), getPricingRegistry: () => ({}) },
  });
}

describe('costTrackingMiddleware', () => {
  describe('wrapGenerate', () => {
    it('partial cache: noCache 200 + cacheRead 800 → input 200, cached 800', async () => {
      const tracker = createTracker();
      const mw = costTrackingMiddleware(tracker);
      const doGenerate = vi.fn().mockResolvedValue({
        usage: {
          inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: undefined },
          outputTokens: { total: 50, text: 50, reasoning: undefined },
        },
      });
      await mw.wrapGenerate!({ doGenerate } as any);
      expect(tracker.inputTokens).toBe(200);
      expect(tracker.cachedReadTokens).toBe(800);
      expect(tracker.outputTokens).toBe(50);
    });

    it('full cache hit: cacheRead 1000 + noCache 0 → input 0, cached 1000 (not 100% from double-count)', async () => {
      const tracker = createTracker();
      const mw = costTrackingMiddleware(tracker);
      const doGenerate = vi.fn().mockResolvedValue({
        usage: {
          inputTokens: { total: 1000, noCache: 0, cacheRead: 1000, cacheWrite: undefined },
          outputTokens: { total: 30 },
        },
      });
      await mw.wrapGenerate!({ doGenerate } as any);
      expect(tracker.inputTokens).toBe(0);
      expect(tracker.cachedReadTokens).toBe(1000);
    });

    it('no cache: total 500, no noCache/cacheRead → falls back to total - cacheRead (500 - 0)', async () => {
      const tracker = createTracker();
      const mw = costTrackingMiddleware(tracker);
      const doGenerate = vi.fn().mockResolvedValue({
        usage: {
          inputTokens: { total: 500 },
          outputTokens: { total: 20 },
        },
      });
      await mw.wrapGenerate!({ doGenerate } as any);
      expect(tracker.inputTokens).toBe(500);
      expect(tracker.cachedReadTokens).toBe(0);
    });

    it('legacy number inputTokens (old provider) → input = number, cached = 0', async () => {
      const tracker = createTracker();
      const mw = costTrackingMiddleware(tracker);
      const doGenerate = vi.fn().mockResolvedValue({
        usage: {
          inputTokens: 400,
          outputTokens: 10,
        },
      });
      await mw.wrapGenerate!({ doGenerate } as any);
      expect(tracker.inputTokens).toBe(400);
      expect(tracker.cachedReadTokens).toBe(0);
    });
  });

  describe('wrapStream', () => {
    it('accumulates from final usage chunk', async () => {
      const tracker = createTracker();
      const mw = costTrackingMiddleware(tracker);
      const usage = {
        inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: undefined },
        outputTokens: { total: 50 },
      };
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'finish', usage, finishReason: 'stop' });
          controller.close();
        },
      });
      const doStream = vi.fn().mockResolvedValue({ stream });
      const { stream: outStream } = await mw.wrapStream!({ doStream } as any);
      // 消费完整个流才能触发 flush
      const reader = outStream.getReader();
      while (!(await reader.read()).done) {}
      expect(tracker.inputTokens).toBe(200);
      expect(tracker.cachedReadTokens).toBe(800);
      expect(tracker.outputTokens).toBe(50);
    });
  });

  describe('cost calculation', () => {
    it('partial cache cost: 200 * full + 800 * cache (not 1000 * full + 800 * cache)', async () => {
      const tracker = createTracker();
      const mw = costTrackingMiddleware(tracker);
      const doGenerate = vi.fn().mockResolvedValue({
        usage: {
          inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: undefined },
          outputTokens: { total: 0 },
        },
      });
      await mw.wrapGenerate!({ doGenerate } as any);
      // input: 200 * 1/1M = 0.0002; cached: 800 * 0.5/1M = 0.0004; total = 0.0006
      // (buggy old code would have: 1000 * 1/1M + 800 * 0.5/1M = 0.001 + 0.0004 = 0.0014)
      expect(tracker.totalCost).toBeCloseTo(0.0006, 6);
    });
  });
});
