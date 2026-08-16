import { describe, it, expect, beforeEach } from 'vitest';
import { estimateRequestBudget } from '../request-budget';
import { manageToolOutputLifecycle } from '../lifecycle';
import { getEstimatorInfra } from '../tokenizer';
import { DEFAULT_COMPACTION_CONFIG } from '../types';

beforeEach(() => {
  getEstimatorInfra().calibrator.clear();
  getEstimatorInfra().tokenCache.clear();
});

// 与运行时一致的自定义 UIMessage 工具 part（agent-handler.ts 构造）
function toolPart(type: string, toolCallId: string, value: string) {
  return {
    type,
    toolCallId,
    input: { command: 'echo x' },
    output: { type: 'text', value },
    state: 'output-available',
  };
}

// 回归：自定义 tool-* part 的估算缓存必须随压缩改写失效。
// 曾因 cacheFingerprint 不覆盖 tool-* 类型，压缩后重估命中旧缓存 → 估算不降 →
// 预算阶梯（Layer 2/Emergency/Extreme）全部白跑 → 报"freed X 仍超限"假超限。
describe('compaction: 自定义 tool-* part 压缩后估算反映 freed', () => {
  it('压缩改写 output 后重估下降（缓存失效正确）', async () => {
    const bigOutput = 'A'.repeat(200_000);
    const msgs = [
      { role: 'assistant' as const, content: '', parts: [toolPart('tool-bash', 'tc-1', bigOutput)] },
    ];

    const before = await estimateRequestBudget(msgs, 'instructions', {}, 'claude-opus-4-6');

    const aggressiveConfig = { ...DEFAULT_COMPACTION_CONFIG.lifecycle, messageBudget: 30_000 };
    const lifecycleResult = manageToolOutputLifecycle(msgs, aggressiveConfig);
    expect(lifecycleResult.tokensFreed).toBeGreaterThan(0);

    const after = await estimateRequestBudget(lifecycleResult.messages, 'instructions', {}, 'claude-opus-4-6');
    expect(after.messagesTokens).toBeLessThan(before.messagesTokens * 0.5);
  });

  it('不同大小的 tool-* 消息估算互不污染（各自独立计数）', async () => {
    const big = { role: 'assistant' as const, content: '', parts: [toolPart('tool-bash', 'tc-big', 'B'.repeat(100_000))] };
    const small = { role: 'assistant' as const, content: '', parts: [toolPart('tool-web_fetch', 'tc-small', 'x')] };

    const estBig = await estimateRequestBudget([big], 'instructions', {}, 'claude-opus-4-6');
    // 不清理缓存，直接估小消息——应给出自己的数值，而非继承大消息
    const estSmall = await estimateRequestBudget([small], 'instructions', {}, 'claude-opus-4-6');
    expect(estSmall.messagesTokens).toBeLessThan(estBig.messagesTokens * 0.5);
  });
});
