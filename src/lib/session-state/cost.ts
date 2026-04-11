import { getDb } from '../db';

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
    this._model = options?.model ?? process.env.DASHSCOPE_MODEL ?? 'unknown';
    this._maxBudgetUsd = options?.maxBudgetUsd ?? 5.0;
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
      const db = getDb();

      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_costs (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER DEFAULT 0,
          output_tokens INTEGER DEFAULT 0,
          cached_read_tokens INTEGER DEFAULT 0,
          total_cost_usd REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_chat_costs_conversation
          ON chat_costs(conversation_id);
      `);

      const existing = db
        .prepare(
          `
        SELECT id, input_tokens, output_tokens, cached_read_tokens, total_cost_usd
        FROM chat_costs WHERE conversation_id = ?
      `,
        )
        .get(this._conversationId) as
        | {
            id: string;
            input_tokens: number;
            output_tokens: number;
            cached_read_tokens: number;
            total_cost_usd: number;
          }
        | undefined;

      if (existing) {
        db.prepare(
          `
          UPDATE chat_costs
          SET input_tokens = ?,
              output_tokens = ?,
              cached_read_tokens = ?,
              total_cost_usd = ?,
              updated_at = datetime('now')
          WHERE conversation_id = ?
        `,
        ).run(this._inputTokens, this._outputTokens, this._cachedReadTokens, this._totalCost, this._conversationId);
      } else {
        db.prepare(
          `
          INSERT INTO chat_costs (
            id, conversation_id, model,
            input_tokens, output_tokens, cached_read_tokens, total_cost_usd
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          `cost_${Date.now()}`,
          this._conversationId,
          this._model,
          this._inputTokens,
          this._outputTokens,
          this._cachedReadTokens,
          this._totalCost,
        );
      }

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