import { describe, it, expect, beforeEach } from 'vitest';
import { estimateRequestBudget } from '../request-budget';
import { estimateMessagesTokens } from '../token-counter';
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

  it('driftRatio < 1（估算偏保守）时 tokenizerBuffer 兜底为 0，不为负', async () => {
    // 校准比率 0.85 → bufferRatio −0.15；若不兜底 tokenizerBuffer 为负，
    // ContextBudgetSnapshotSchema(tokenizerBuffer: nonnegative) 校验会失败。
    getEstimatorInfra().calibrator.clear();
    getEstimatorInfra().tokenCache.clear();
    const msgs = [{ role: 'user' as const, content: 'word '.repeat(1000) }];
    const base0 = await estimateRequestBudget(msgs, 'sys', {}, 'unknown-model');
    const baseTokens = base0.messagesTokens + base0.instructionsTokens + base0.toolsTokens;
    recordUsageSample('unknown-model', baseTokens, Math.round(baseTokens * 0.85));
    getEstimatorInfra().tokenCache.clear();
    const est = await estimateRequestBudget(msgs, 'sys', {}, 'unknown-model');
    expect(est.tokenizerBuffer).toBe(0);
    expect(est.totalTokensWithBuffer).toBe(est.totalTokens);
  });

  it('exposes trigger/hardLimit from the single policy', async () => {
    const est = await estimateRequestBudget(smallMsgs, 'instructions', {}, 'unknown-model');
    expect(est.triggerTokens).toBe(110_000); // 128k − 18k char buffer（窗口坐标系，含 outputReserve）
    expect(est.hardLimitTokens).toBe(125_000); // 128k − 3k
    expect(est.shouldTrigger).toBe(false);
  });

  it('a large request near the window triggers', async () => {
    resetCalibration('unknown-model');
    // 构造一个接近触发线的消息（约 410k 字符 ≈ 102.5k tokens，char 估算 4 chars/token）
    const big = { role: 'user' as const, content: 'word '.repeat(82_000) };
    const est = await estimateRequestBudget([big], 'instructions', {}, 'unknown-model');
    expect(est.messagesTokens).toBeGreaterThan(90_000);
    // total ≈ 102.5k 输入 + 8k outputReserve = 110.5k ≥ trigger 110k → 触发
    expect(est.shouldTrigger).toBe(true);
  });

  it('proactive trigger: shouldTrigger true before the request actually exceeds the window', async () => {
    resetCalibration('unknown-model');
    // ~103.75k messages tokens + 8k outputReserve = ~111.75k total
    // ≥ trigger 110k（应主动升档）但 < 窗口 128k（未超限）
    const big = { role: 'user' as const, content: 'word '.repeat(83_000) };
    const est = await estimateRequestBudget([big], 'instructions', {}, 'unknown-model');
    expect(est.shouldTrigger).toBe(true);
    expect(est.exceedsLimit).toBe(false);
  });

  it('char model: 校准不双重放大——聚合 buffer 生效,源头计数不被放大', async () => {
    getEstimatorInfra().calibrator.clear();
    getEstimatorInfra().tokenCache.clear();
    // 内容: 5000 chars → char 估算 ≈1250 tokens（drift=1 基线）
    const msgs = [{ role: 'user' as const, content: 'word '.repeat(1000) }];
    const base0 = await estimateRequestBudget(msgs, 'sys', {}, 'unknown-model');
    const baseTokens = base0.messagesTokens + base0.instructionsTokens + base0.toolsTokens;
    expect(baseTokens).toBeGreaterThan(1000);

    // 喂 usage 真值 = 1.3 × base → driftRatio → 1.3
    recordUsageSample('unknown-model', baseTokens, Math.round(baseTokens * 1.3));
    // 清空消息缓存强制重算（否则缓存掩盖源头校准）
    getEstimatorInfra().tokenCache.clear();
    const est = await estimateRequestBudget(msgs, 'sys', {}, 'unknown-model');

    // 源头计数不应被校准放大（固定代码 = 基线 b；双重 bug = 1.3×b）
    expect(est.messagesTokens).toBeLessThan(baseTokens * 1.1);
    // 聚合校准: totalWithBuffer − outputReserve ≈ 1.3 × base
    const calibratedTotal = est.totalTokensWithBuffer - est.outputReserve;
    expect(calibratedTotal).toBeGreaterThan(baseTokens * 1.2);
    expect(calibratedTotal).toBeLessThan(baseTokens * 1.4);
  });

  it('校准闭环(char): 多步 估算→usage 配对后 totalWithBuffer 收敛到真值', async () => {
    getEstimatorInfra().calibrator.clear();
    getEstimatorInfra().tokenCache.clear();
    const msgs = [{ role: 'user' as const, content: 'word '.repeat(1000) }];
    // 真值比率 1.25（provider 比本地多计 25%）
    for (let step = 0; step < 5; step++) {
      const est = await estimateRequestBudget(msgs, 'sys', {}, 'unknown-model');
      const baseTokens = est.messagesTokens + est.instructionsTokens + est.toolsTokens;
      recordUsageSample('unknown-model', baseTokens, Math.round(baseTokens * 1.25));
    }
    const final = await estimateRequestBudget(msgs, 'sys', {}, 'unknown-model');
    const base = final.messagesTokens + final.instructionsTokens + final.toolsTokens;
    const estimatedWithBuffer = final.totalTokensWithBuffer - final.outputReserve;
    // 收敛后估算(含 buffer) ≈ 1.25 × base
    expect(estimatedWithBuffer / base).toBeGreaterThan(1.2);
    expect(estimatedWithBuffer / base).toBeLessThan(1.31);
  });

  it('校准闭环(BPE 近似模型): tokenizerBuffer 对非 char 模型同样生效', async () => {
    getEstimatorInfra().calibrator.clear();
    getEstimatorInfra().tokenCache.clear();
    const text = 'The quick brown fox jumps over the lazy dog while the model analyzes source files and measures tokens for the context window. '.repeat(30);
    const msgs = [{ role: 'user' as const, content: text }];
    for (let step = 0; step < 4; step++) {
      const est = await estimateRequestBudget(msgs, 'sys', {}, 'claude-opus-4-6');
      const baseTokens = est.messagesTokens + est.instructionsTokens + est.toolsTokens;
      recordUsageSample('claude-opus-4-6', baseTokens, Math.round(baseTokens * 1.2));
    }
    const final = await estimateRequestBudget(msgs, 'sys', {}, 'claude-opus-4-6');
    const base = final.messagesTokens + final.instructionsTokens + final.toolsTokens;
    expect(final.tokenizerBuffer).toBeGreaterThan(0);
    const estimatedWithBuffer = final.totalTokensWithBuffer - final.outputReserve;
    expect(estimatedWithBuffer / base).toBeGreaterThan(1.15);
    expect(estimatedWithBuffer / base).toBeLessThan(1.26);
  });
});

// ============================================================
// usage 锚点（pi 学来的锚定语义）：provider 真值基线代替全量重估 × 校准 buffer
// ============================================================
describe('estimateRequestBudget (usage 锚点)', () => {
  it('anchored: 以真值 usage 为基线，tokenizerBuffer 置 0，锚点后尾巴本地估算叠加', async () => {
    const tail = { role: 'user' as const, content: 'continue the work' };
    const msgs: import('ai').ModelMessage[] = [
      { role: 'user' as const, content: 'summarize this file' },
      { role: 'assistant' as const, content: 'here is the summary' },
      tail,
    ];
    const inputTokens = 5000;
    const outputTokens = 300;

    const est = await estimateRequestBudget(
      msgs, 'sys', {}, 'unknown-model', undefined,
      { inputTokens, outputTokens },
    );

    // messagesTokens = 真值中扣除指令/工具后的 history 跨度 + 该 assistant 自身输出 + 尾巴
    const trailing = await estimateMessagesTokens([tail], 'unknown-model');
    const expectedMessages = Math.max(0, inputTokens - est.instructionsTokens - est.toolsTokens) + outputTokens + trailing;
    expect(est.messagesTokens).toBe(expectedMessages);
    expect(est.totalTokens).toBe(expectedMessages + est.instructionsTokens + est.toolsTokens + est.outputReserve);
    // 锚定态无漂移缓冲：真值基线不需要
    expect(est.tokenizerBuffer).toBe(0);
    expect(est.totalTokensWithBuffer).toBe(est.totalTokens);
    expect(est.exceedsLimitWithBuffer).toBe(est.exceedsLimit);
  });

  it('anchored: 校准 drift 再高也不叠加 tokenizerBuffer（避免同一 usage 自证双重放大）', async () => {
    // 制造高位漂移（1.6 顶格）
    recordUsageSample('unknown-model', 1000, 1600);
    getEstimatorInfra().tokenCache.clear();

    const msgs: import('ai').ModelMessage[] = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'world' },
    ];
    const est = await estimateRequestBudget(
      msgs, 'sys', {}, 'unknown-model', undefined,
      { inputTokens: 4000, outputTokens: 100 },
    );

    expect(est.tokenizerBuffer).toBe(0);
    expect(est.totalTokensWithBuffer).toBe(est.totalTokens);
    // 锚定总量 = input + output + 指令/工具 + outputReserve（无尾巴）
    expect(est.totalTokens).toBe(
      Math.max(0, 4000 - est.instructionsTokens - est.toolsTokens) + 100 + est.instructionsTokens + est.toolsTokens + est.outputReserve,
    );
  });

  it('anchored: 消息中无 assistant 时回退原路径（仍走校准 buffer，不被锚点劫持）', async () => {
    recordUsageSample('unknown-model', 1000, 1300);
    getEstimatorInfra().tokenCache.clear();

    const msgs = [{ role: 'user' as const, content: 'hello world' }];
    const est = await estimateRequestBudget(
      msgs, 'instructions', {}, 'unknown-model', undefined,
      { inputTokens: 10, outputTokens: 5 },
    );

    const baseTokens = est.messagesTokens + est.instructionsTokens + est.toolsTokens;
    expect(est.tokenizerBuffer).toBe(Math.round(baseTokens * 0.3));
    expect(est.tokenizerBuffer).toBeGreaterThan(0);
    expect(est.totalTokensWithBuffer).toBe(est.totalTokens + est.tokenizerBuffer);
  });
});
