import { getGlobalDataStore } from '../../foundation/datastore';
import { DEFAULT_MAX_BUDGET_USD } from '../../config/defaults';

const PRICING: Record<string, { input: number; output: number; cached: number }> = {
  'qwen-max': { input: 4, output: 12, cached: 1 },
  'qwen-plus': { input: 1.5, output: 4.5, cached: 0.5 },
  'qwen-turbo': { input: 0.5, output: 1.5, cached: 0.2 },
  'qwen-max-latest': { input: 4, output: 12, cached: 1 },
  'qwen-plus-latest': { input: 1.5, output: 4.5, cached: 0.5 },
  'qwen-turbo-latest': { input: 0.5, output: 1.5, cached: 0.2 },
  'deepseek-v3': { input: 1.2, output: 4.8, cached: 0.4 },
};

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

  constructor(conversationId: string, options?: CostTrackerOptions) {
    this._conversationId = conversationId;
    this._model = options?.model ?? 'unknown';
    this._maxBudgetUsd = options?.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
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
    const pricing = PRICING[this._model] ?? { input: 1.5, output: 4.5, cached: 0.5 };

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

  async persistToDB(): Promise<void> {
    if (this._persistedToDB) return;

    try {
      const costStore = getGlobalDataStore().costStore;

      costStore.saveCostRecord({
        conversationId: this._conversationId,
        model: this._model,
        inputTokens: this._inputTokens,
        outputTokens: this._outputTokens,
        cachedReadTokens: this._cachedReadTokens,
        totalCostUsd: this._totalCost,
      });

      this._persistedToDB = true;
    } catch (error) {
      console.error(`[CostTracker] DB persistence failed: ${(error as Error).message}`);
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

export { PRICING };