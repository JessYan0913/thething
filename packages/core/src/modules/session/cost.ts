import type { CostStore } from '../../primitives/datastore/types';
import { DEFAULT_MAX_BUDGET_USD } from '../../services/config/defaults';
import type { PricingResolver } from '../../services/model/pricing';
import { logger } from '../../primitives/logger';

export interface CostDelta {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  inputCost: number;
  outputCost: number;
  cachedCost: number;
  totalCost: number;
}

export interface CostTrackerOptions {
  model?: string;
  maxBudgetUsd?: number;
  pricingResolver?: PricingResolver;
}

export class CostTracker {
  private _totalCost = 0;
  private _inputTokens = 0;
  private _outputTokens = 0;
  private _cachedReadTokens = 0;
  private _model: string;
  private _maxBudgetUsd: number;
  private _persistedToDB = false;
  private _conversationId: string;
  private _costStore: CostStore;
  private _pricingResolver: PricingResolver;

  constructor(conversationId: string, costStore: CostStore, options?: CostTrackerOptions) {
    this._conversationId = conversationId;
    this._model = options?.model ?? 'unknown';
    // 注意：maxBudgetUsd 应从 BehaviorConfig.maxBudgetUsdPerSession 获取并传入
    // 此处 fallback 仅用于未传入配置时的兜底
    this._maxBudgetUsd = options?.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
    this._costStore = costStore;
    this._pricingResolver = options?.pricingResolver ?? {
      getModelPricing: () => ({ input: 1.5, output: 4.5, cached: 0.5 }),
      getPricingRegistry: () => ({}),
    };
  }

  get totalCost(): number {
    return this._totalCost;
  }

  get inputTokens(): number {
    return this._inputTokens;
  }

  get outputTokens(): number {
    return this._outputTokens;
  }

  get cachedReadTokens(): number {
    return this._cachedReadTokens;
  }

  get isOverBudget(): boolean {
    return this._totalCost >= this._maxBudgetUsd;
  }

  get remainingBudget(): number {
    return Math.max(0, this._maxBudgetUsd - this._totalCost);
  }

  calculateDelta(inputTokens: number, outputTokens: number, cachedReadTokens: number): CostDelta {
    const pricing = this._pricingResolver.getModelPricing(this._model);

    const inputCost = (inputTokens * pricing.input) / 1_000_000;
    const outputCost = (outputTokens * pricing.output) / 1_000_000;
    const cachedCost = (cachedReadTokens * pricing.cached) / 1_000_000;
    const totalCost = inputCost + outputCost + cachedCost;

    return {
      inputTokens,
      outputTokens,
      cachedReadTokens,
      inputCost,
      outputCost,
      cachedCost,
      totalCost,
    };
  }

  accumulate(delta: CostDelta): void {
    this._totalCost += delta.totalCost;
    this._inputTokens += delta.inputTokens;
    this._outputTokens += delta.outputTokens;
    this._cachedReadTokens += delta.cachedReadTokens;
  }

  accumulateFromUsage(inputTokens: number, outputTokens: number, cachedReadTokens: number): CostDelta {
    const delta = this.calculateDelta(inputTokens, outputTokens, cachedReadTokens);
    this.accumulate(delta);
    return delta;
  }

  /**
   * 压缩钩子：与 TokenBudgetTracker.reportCompaction 保持调用契约（管线照旧触发），
   * 但 CostTracker 是生命周期成本账本，不承载"上下文窗口"语义——isOverBudget 只看
   * _totalCost（单调累计，绝不下调）。面板"缓存命中率"由 cachedReadTokens/
   * (inputTokens+cachedReadTokens) 推导，旧代码在此把 cachedReadTokens 清零并扣减
   * inputTokens，导致每次压缩执行后命中率被压成 0（实测逐步真实命中 94-99%，
   * 面板却显示 14.77%，见 08-21 CacheProbe 诊断）。窗口语义由 TokenBudgetTracker
   * （session/token-budget.ts）单独维护，成本账本不随压缩改写。
   */
  reportCompaction(tokensFreed: number): void {
    void tokensFreed; // no-op：成本账本单调累计，压缩只改窗口水位
  }

  /**
   * 从 costStore 加载已持久化的成本基线，刷新页面后保证 session 内累加器
   * 不会从零开始——否则刷新后第一次调用如果全量命中 cache，inputTokens=0
   * 但 cachedReadTokens>0，命中率公式 cachedRead/(input+cachedRead) 直接 100%。
   *
   * 模型可能在两次会话之间变化：仅恢复 token 计数与总费用（已按当时模型计费），
   * 不重算单次 delta。后续 accumulate() 的新 turn 仍按当前 _model 计费。
   */
  async hydrate(): Promise<void> {
    try {
      const record = await this._costStore.getCostByConversation(this._conversationId);
      if (!record) return;
      this._inputTokens = record.inputTokens;
      this._outputTokens = record.outputTokens;
      this._cachedReadTokens = record.cachedReadTokens;
      this._totalCost = record.totalCostUsd;
    } catch (error) {
      logger.error('CostTracker', `Hydrate failed: ${(error as Error).message}`);
    }
  }

  async persistToDB(): Promise<void> {
    if (this._persistedToDB) return;

    try {
      this._costStore.saveCostRecord({
        conversationId: this._conversationId,
        model: this._model,
        inputTokens: this._inputTokens,
        outputTokens: this._outputTokens,
        cachedReadTokens: this._cachedReadTokens,
        totalCostUsd: this._totalCost,
      });

      this._persistedToDB = true;
    } catch (error) {
      logger.error('CostTracker', `DB persistence failed: ${(error as Error).message}`);
    }
  }

  getSummary(): {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    totalCostUsd: number;
    maxBudgetUsd: number;
    isOverBudget: boolean;
    remainingBudget: number;
    budgetUsagePercent: number;
  } {
    return {
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
      cachedReadTokens: this._cachedReadTokens,
      totalCostUsd: this._totalCost,
      maxBudgetUsd: this._maxBudgetUsd,
      isOverBudget: this.isOverBudget,
      remainingBudget: this.remainingBudget,
      budgetUsagePercent: (this._totalCost / this._maxBudgetUsd) * 100,
    };
  }
}
