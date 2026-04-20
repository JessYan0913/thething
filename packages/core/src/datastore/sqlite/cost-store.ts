// ============================================================
// SQLite Cost Store Implementation
// ============================================================

import type { SqliteDatabase } from '../../types/sqlite';
import type { CostStore, CostRecord, CostRow } from '../types';

/**
 * SQLite-based CostStore implementation
 */
export class SQLiteCostStore implements CostStore {
  private schemaInitialized = false;

  constructor(private db: SqliteDatabase) {}

  ensureSchema(): void {
    if (this.schemaInitialized) return;

    this.db.exec(`
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

    this.schemaInitialized = true;
  }

  saveCostRecord(params: {
    conversationId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    totalCostUsd: number;
  }): CostRecord {
    this.ensureSchema();

    const existing = this.getCostByConversation(params.conversationId);

    if (existing) {
      this.updateCostByConversation(params.conversationId, {
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cachedReadTokens: params.cachedReadTokens,
        totalCostUsd: params.totalCostUsd,
      });
      return this.getCostByConversation(params.conversationId)!;
    }

    const id = `cost_${Date.now()}`;
    this.db
      .prepare(
        `INSERT INTO chat_costs (
          id, conversation_id, model,
          input_tokens, output_tokens, cached_read_tokens, total_cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.conversationId,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.cachedReadTokens,
        params.totalCostUsd
      );

    return this.getCostByConversation(params.conversationId)!;
  }

  getCostByConversation(conversationId: string): CostRecord | null {
    this.ensureSchema();

    const stmt = this.db.prepare(
      'SELECT * FROM chat_costs WHERE conversation_id = ?'
    );
    const row = stmt.get(conversationId) as CostRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  updateCostByConversation(
    conversationId: string,
    params: {
      inputTokens: number;
      outputTokens: number;
      cachedReadTokens: number;
      totalCostUsd: number;
    }
  ): void {
    this.ensureSchema();

    this.db
      .prepare(
        `UPDATE chat_costs
         SET input_tokens = ?,
             output_tokens = ?,
             cached_read_tokens = ?,
             total_cost_usd = ?,
             updated_at = datetime('now')
         WHERE conversation_id = ?`
      )
      .run(
        params.inputTokens,
        params.outputTokens,
        params.cachedReadTokens,
        params.totalCostUsd,
        conversationId
      );
  }

  private mapRow(row: CostRow): CostRecord {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cachedReadTokens: row.cached_read_tokens,
      totalCostUsd: row.total_cost_usd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}