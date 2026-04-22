// ============================================================
// SQLite Summary Store Implementation
// ============================================================

import type { SqliteDatabase } from '../types';
import type { SummaryStore, StoredSummary, SummaryRow } from '../types';
import { nanoid } from 'nanoid';

/**
 * SQLite-based SummaryStore implementation
 */
export class SQLiteSummaryStore implements SummaryStore {
  constructor(private db: SqliteDatabase) {}

  saveSummary(
    conversationId: string,
    summary: string,
    lastMessageOrder: number,
    preCompactTokenCount: number
  ): StoredSummary {
    const existing = this.getSummaryByConversation(conversationId);

    let id: string;

    if (existing) {
      id = existing.id;
      const updateStmt = this.db.prepare(
        'UPDATE summaries SET summary = ?, last_message_order = ?, pre_compact_token_count = ?, compacted_at = CURRENT_TIMESTAMP WHERE id = ?'
      );
      updateStmt.run(summary, lastMessageOrder, preCompactTokenCount, id);
    } else {
      id = nanoid();
      const insertStmt = this.db.prepare(
        'INSERT INTO summaries (id, conversation_id, summary, last_message_order, pre_compact_token_count) VALUES (?, ?, ?, ?, ?)'
      );
      insertStmt.run(
        id,
        conversationId,
        summary,
        lastMessageOrder,
        preCompactTokenCount
      );
    }

    return this.getSummaryById(id)!;
  }

  getSummaryById(id: string): StoredSummary | null {
    const stmt = this.db.prepare('SELECT * FROM summaries WHERE id = ?');
    const row = stmt.get(id) as SummaryRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getSummaryByConversation(conversationId: string): StoredSummary | null {
    const stmt = this.db.prepare(
      'SELECT * FROM summaries WHERE conversation_id = ? ORDER BY compacted_at DESC LIMIT 1'
    );
    const row = stmt.get(conversationId) as SummaryRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  deleteSummariesByConversation(conversationId: string): void {
    const stmt = this.db.prepare(
      'DELETE FROM summaries WHERE conversation_id = ?'
    );
    stmt.run(conversationId);
  }

  private mapRow(row: SummaryRow): StoredSummary {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      summary: row.summary,
      compactedAt: row.compacted_at,
      lastMessageOrder: row.last_message_order,
      preCompactTokenCount: row.pre_compact_token_count,
    };
  }
}