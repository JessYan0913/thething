import type { LanguageModelUsage } from 'ai';
import type { CompactionResult } from '../../services/config/compaction-types';

// 校准系数的合理区间:字符估算误差通常在 ±50% 内,超出即视为异常样本
const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 2;
// EMA 平滑因子:新样本权重 0.3,兼顾收敛速度与稳定性
const CALIBRATION_ALPHA = 0.3;

export class TokenBudgetTracker {
  private _sessionInputTokens = 0;
  private _sessionOutputTokens = 0;
  private _sessionCachedReadTokens = 0;
  private _lastStepInputTokens = 0;
  private _lastStepOutputTokens = 0;
  private _lastStepCachedReadTokens = 0;
  private _lastCompactionTokens = 0;
  /** 触发压缩时的水位百分比 */
  private _compactionTriggerWatermark = 0;
  // usage 反馈校准(见 docs/compaction-redesign.md):
  // 实际 input tokens / 估算 tokens 的滑动平均,用于修正后续估算
  private _calibration = 1;
  private _pendingEstimate: number | null = null;

  constructor(
    private readonly maxContextTokens: number = 128_000,
    private readonly compactThreshold: number = 25_000,
  ) {}

  accumulate(usage: LanguageModelUsage): void {
    this._lastStepInputTokens = usage.inputTokens ?? 0;
    this._lastStepOutputTokens = usage.outputTokens ?? 0;
    this._lastStepCachedReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
    this._sessionInputTokens += this._lastStepInputTokens;
    this._sessionOutputTokens += this._lastStepOutputTokens;
    this._sessionCachedReadTokens += this._lastStepCachedReadTokens;
    // 若上一步记录了估算值,用本次真实 input tokens 配对校准
    const actualInput = usage.inputTokens ?? 0;
    if (this._pendingEstimate !== null && this._pendingEstimate > 0 && actualInput > 0) {
      this.updateCalibration(actualInput / this._pendingEstimate);
    }
    this._pendingEstimate = null;
  }

  /**
   * 记录本次请求发出前的估算输入 token 数。
   * 下一次 accumulate 收到真实 usage 时与之配对更新校准系数。
   */
  recordEstimate(estimatedInputTokens: number): void {
    this._pendingEstimate = estimatedInputTokens;
  }

  /** 当前校准系数(实际/估算 的滑动平均,夹在 [0.5, 2]) */
  get calibration(): number {
    return this._calibration;
  }

  private updateCalibration(ratio: number): void {
    const clamped = Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, ratio));
    this._calibration = this._calibration * (1 - CALIBRATION_ALPHA) + clamped * CALIBRATION_ALPHA;
  }

  get inputTokens(): number {
    return this._sessionInputTokens;
  }

  get outputTokens(): number {
    return this._sessionOutputTokens;
  }

  get cachedReadTokens(): number {
    return this._sessionCachedReadTokens;
  }

  get lastStepInputTokens(): number {
    return this._lastStepInputTokens;
  }

  get lastStepOutputTokens(): number {
    return this._lastStepOutputTokens;
  }

  get lastStepCachedReadTokens(): number {
    return this._lastStepCachedReadTokens;
  }

  get totalTokens(): number {
    return this._sessionInputTokens + this._sessionOutputTokens;
  }

  get remainingTokens(): number {
    return this.maxContextTokens - this.totalTokens;
  }

  get usagePercentage(): number {
    return (this.totalTokens / this.maxContextTokens) * 100;
  }

  shouldCompact(): boolean {
    return this.totalTokens > this.maxContextTokens - this.compactThreshold;
  }

  reportCompaction(result: CompactionResult, triggerWatermark?: number): void {
    this._lastCompactionTokens = result.tokensFreed;
    if (triggerWatermark != null) {
      this._compactionTriggerWatermark = triggerWatermark;
    }
    const preCompactTokens = this.totalTokens;
    const postCompactTokens = preCompactTokens - result.tokensFreed;

    if (postCompactTokens < this.maxContextTokens) {
      this._sessionInputTokens = Math.max(0, this._sessionInputTokens - result.tokensFreed);
      // 压缩后 context 内容变化，cache prefix 失效。旧 cache read 计数不能再算到
      // 新 session 的命中率里——否则 inputTokens 被扣、cachedReadTokens 残留，
      // 命中率会虚高到接近 100%。
      this._sessionCachedReadTokens = 0;
      this._lastStepCachedReadTokens = 0;
    }
  }

  getSummary(): {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    totalTokens: number;
    remainingTokens: number;
    usagePercentage: number;
    shouldCompact: boolean;
    lastCompactionTokens: number;
    compactionTriggerWatermark: number;
  } {
    return {
      inputTokens: this._sessionInputTokens,
      outputTokens: this._sessionOutputTokens,
      cachedReadTokens: this._sessionCachedReadTokens,
      totalTokens: this.totalTokens,
      remainingTokens: this.remainingTokens,
      usagePercentage: this.usagePercentage,
      shouldCompact: this.shouldCompact(),
      lastCompactionTokens: this._lastCompactionTokens,
      compactionTriggerWatermark: this._compactionTriggerWatermark,
    };
  }
}