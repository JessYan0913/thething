// ============================================================
// CompactionStateTracker - 压缩状态机 + 事件累计
// ============================================================
// 单一职责：跟踪压缩事件的状态、次数、累计释放量。
// 与 TokenBudgetTracker 正交（本模块只关心"压缩过几次、释放多少"，
// 不关心"用了多少计费 tokens"或"窗口使用率"）。
//
// 设计参考：docs/context-usage-redesign.md §3

import { z } from 'zod';

/** 压缩状态机：3 个合法状态（overBudget 是 estimation 维度，不在此处） */
export const CompactionState = z.enum(['idle', 'compacting', 'justCompacted']);
export type CompactionState = z.infer<typeof CompactionState>;

export const CompactionSnapshotSchema = z.object({
  state: CompactionState,
  compactionsCount: z.number().int().nonnegative(),
  totalFreed: z.number().int().nonnegative(),
  triggerPercent: z.number().min(0).max(1),
});
export type CompactionSnapshot = z.infer<typeof CompactionSnapshotSchema>;

export interface CompactionStateTrackerOptions {
  /** 触发压缩的窗口使用率阈值（0-1，例如 0.85） */
  triggerPercent: number;
  /** justCompacted 状态持续多少步后自动回 idle，默认 1 */
  justCompactedDurationSteps?: number;
}

/**
 * 压缩状态机 + 事件累计。
 *
 * 不变式（CI 必测）：
 * - INV-1: compactionsCount 单调非递减
 * - INV-2: totalFreed 单调非递减
 * - INV-3: totalFreed === sum of per-step freed
 * - INV-4: state ∈ {idle, compacting, justCompacted}
 * - INV-5: state === 'compacting' → 下一步必为 'justCompacted' | 'idle'
 */
export class CompactionStateTracker {
  private _state: CompactionState = 'idle';
  private _compactionsCount = 0;
  private _totalFreed = 0;
  private _justCompactedStep = -1;
  private readonly _triggerPercent: number;
  private readonly _justCompactedDurationSteps: number;

  constructor(opts: CompactionStateTrackerOptions) {
    if (opts.triggerPercent < 0 || opts.triggerPercent > 1) {
      throw new Error(`triggerPercent must be 0-1, got ${opts.triggerPercent}`);
    }
    this._triggerPercent = opts.triggerPercent;
    this._justCompactedDurationSteps = opts.justCompactedDurationSteps ?? 1;
  }

  /** 准备执行压缩前调用。pipeline.ts 在 compact(messages) 前调。 */
  recordAttempt(): void {
    this._state = 'compacting';
  }

  /**
   * 压缩执行后调用。freed 来自 estimateMessagesDiff（真值）。
   * 如果 freed <= 0（no-op 压缩），不累加。
   */
  recordResult(freed: number): void {
    if (freed > 0) {
      this._compactionsCount++;
      this._totalFreed += freed;
      this._state = 'justCompacted';
      this._justCompactedStep = this._currentStep;
    } else {
      this._state = 'idle';
    }
  }

  /**
   * 每步 prepareStep 入口调用。
   * - 若 state === 'justCompacted' 且已过 N 步，自动回 idle
   * - 更新内部 _currentStep（供 recordResult 引用）
   */
  tickStep(stepNumber: number): void {
    this._currentStep = stepNumber;
    if (this._state === 'justCompacted' && stepNumber >= this._justCompactedStep + this._justCompactedDurationSteps) {
      this._state = 'idle';
    }
  }

  getSnapshot(): CompactionSnapshot {
    return {
      state: this._state,
      compactionsCount: this._compactionsCount,
      totalFreed: this._totalFreed,
      triggerPercent: this._triggerPercent,
    };
  }

  /** 内部状态：当前步号（供 recordResult 记录 justCompactedStep） */
  private _currentStep = 0;
}
