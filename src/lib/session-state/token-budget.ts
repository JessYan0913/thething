import type { LanguageModelUsage } from 'ai';
import type { CompactionResult } from '../compaction/types';

export interface TokenBudgetTrackerOptions {
  maxContextTokens?: number;
  compactThreshold?: number;
}

export class TokenBudgetTracker {
  private _sessionInputTokens = 0;
  private _sessionOutputTokens = 0;
  private _sessionCachedReadTokens = 0;
  private _lastCompactionTokens = 0;

  constructor(
    private readonly maxContextTokens: number = 128_000,
    private readonly compactThreshold: number = 25_000,
  ) {}

  accumulate(usage: LanguageModelUsage): void {
    this._sessionInputTokens += usage.inputTokens ?? 0;
    this._sessionOutputTokens += usage.outputTokens ?? 0;
    this._sessionCachedReadTokens += usage.cachedInputTokens ?? 0;
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

  reportCompaction(result: CompactionResult): void {
    this._lastCompactionTokens = result.tokensFreed;
    const preCompactTokens = this.totalTokens;
    const postCompactTokens = preCompactTokens - result.tokensFreed;

    if (postCompactTokens < this.maxContextTokens) {
      this._sessionInputTokens = Math.max(0, this._sessionInputTokens - result.tokensFreed);
    }
  }

  finalize(usage: LanguageModelUsage): void {
    this.accumulate(usage);
  }

  getSummary(): {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    totalTokens: number;
    remainingTokens: number;
    usagePercentage: number;
    shouldCompact: boolean;
  } {
    return {
      inputTokens: this._sessionInputTokens,
      outputTokens: this._sessionOutputTokens,
      cachedReadTokens: this._sessionCachedReadTokens,
      totalTokens: this.totalTokens,
      remainingTokens: this.remainingTokens,
      usagePercentage: this.usagePercentage,
      shouldCompact: this.shouldCompact(),
    };
  }
}