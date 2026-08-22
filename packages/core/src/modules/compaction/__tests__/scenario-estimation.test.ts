import { describe, it, expect, beforeEach } from 'vitest';
import { estimateMessageTokens } from '../token-counter';
import { estimateRequestBudget } from '../request-budget';
import { checkInitialBudget } from '../budget-check';
import { getEstimatorInfra } from '../tokenizer';

beforeEach(() => {
  getEstimatorInfra().calibrator.clear();
  getEstimatorInfra().tokenCache.clear();
});

// 大工具 schema（约 12k 字符描述 → 字符估算 ≈3k tokens）
function bigTool(name: string): Record<string, unknown> {
  return {
    description: 'big tool',
    inputSchema: { type: 'object', properties: { a: { type: 'string', description: 'x'.repeat(12_000) } } },
  };
}

describe('估算地基场景（估算准确不低估）', () => {
  it('多图消息: 每张图按 IMAGE_TOKENS 计费，不再忽略', async () => {
    const with2Img = { role: 'user', content: [
      { type: 'image', image: 'data:image/png;base64,AAA' },
      { type: 'image', image: 'data:image/png;base64,BBB' },
      { type: 'text', text: 'hello' },
    ] } as never;
    const with0Img = { role: 'user', content: [{ type: 'text', text: 'hello' }] } as never;
    const a = await estimateMessageTokens(with2Img, 'unknown-model');
    const b = await estimateMessageTokens(with0Img, 'unknown-model');
    // 2 × 1500 图片计费
    expect(a - b).toBeGreaterThanOrEqual(3000);
  });

  it('消息级缓存: 同消息二次估算命中；内容改写(长度变化)后 miss 重算', async () => {
    const msg = { role: 'user', content: 'hello world' } as never;
    const first = await estimateMessageTokens(msg, 'unknown-model');
    const cached = await estimateMessageTokens(msg, 'unknown-model');
    expect(cached).toBe(first);

    const changed = { role: 'user', content: 'this is a substantially longer message that changes the token count' } as never;
    const third = await estimateMessageTokens(changed, 'unknown-model');
    expect(third).not.toBe(first);
  });
});

describe('22.8k 小窗口 + 大工具 schema（主动触发，非等 100%）', () => {
  it('输入占用(含工具)达触发线即 shouldTrigger，未超窗口', async () => {
    const tools = {
      big_a: bigTool('a'),
      big_b: bigTool('b'),
      big_c: bigTool('c'),
      big_d: bigTool('d'),
    } as never;
    const est = await estimateRequestBudget(
      [{ role: 'user', content: 'hi' } as never],
      'sys',
      tools,
      'unknown-model',
      22_800,
    );
    // 22.8k, char 级 buffer: effectiveBudget=14800, buffer=5000 → 输入触发线 9800
    // （窗口坐标 trigger = 22800 − 5000 = 17800，含 outputReserve）。
    // 4×~3k 工具 ≈ 12k 纯输入 ≥ 9800 → 触发
    expect(est.triggerTokens).toBe(17_800);
    expect(est.toolsTokens).toBeGreaterThan(2_000);
    expect(est.shouldTrigger).toBe(true);
    expect(est.exceedsLimit).toBe(false); // 未超窗口，但达触发线 → 主动升档
  });

  it('outputReserve 恒为扁平默认（8000）：学 pi 后输出上限交由 provider 默认，预算预留不再随 per-model 配置伸缩', async () => {
    const est = await estimateRequestBudget(
      [{ role: 'user', content: 'hi' } as never],
      'sys',
      {},
      'unknown-model',
      128_000,
    );
    expect(est.outputReserve).toBe(8_000);
    // 触发线 = trigger − outputReserve 之输入部分，随模型上下文伸缩而非 per-model 输出配置
    expect(est.triggerTokens - est.outputReserve).toBeGreaterThan(0);
  });

  it('budget-check: 大 schema 触发工具过滤（不再因 128k 魔法阈值放行）', async () => {
    const tools = {
      mcp_alpha: bigTool('alpha'),
      mcp_beta: bigTool('beta'),
      mcp_gamma: bigTool('gamma'),
      connector_x: bigTool('x'),
    } as never;
    const result = await checkInitialBudget(
      [{ role: 'user', content: 'hi' } as never],
      'sys',
      tools,
      'unknown-model',
      undefined,
      { contextLimit: 22_800 },
    );
    expect(result.passed).toBe(true);
    expect(result.adjustedTools).toBeDefined();
    if (result.adjustedTools) {
      // 工具过滤应移除部分大 schema 工具（toolsTokens 远超 10% 预算线 2280）
      expect(Object.keys(result.adjustedTools).length).toBeLessThan(Object.keys(tools).length);
    }
    // 动作日志里应出现工具过滤
    expect(result.actions.join(' ')).toMatch(/Tool filter/);
  });
});
