// ============================================================
// SQLite Summary Store Implementation
// ============================================================

import type { SqliteDatabase } from '../../../primitives/datastore/types';
import type { SummaryStore, StoredSummary, SummaryRow } from '../../../primitives/datastore/types';
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
    preCompactTokenCount: number,
    anchorMessageId?: string | null,
    branchId?: string | null
  ): StoredSummary {
    const resolvedBranchId = branchId === undefined ? this.getActiveBranchId(conversationId) : branchId;
    const existing = this.getSummaryByConversation(conversationId, resolvedBranchId);

    let id: string;
    const anchor = anchorMessageId ?? null;

    if (existing) {
      id = existing.id;
      const updateStmt = this.db.prepare(
        'UPDATE summaries SET summary = ?, last_message_order = ?, pre_compact_token_count = ?, anchor_message_id = ?, branch_id = ?, compacted_at = CURRENT_TIMESTAMP WHERE id = ?'
      );
      updateStmt.run(summary, lastMessageOrder, preCompactTokenCount, anchor, resolvedBranchId, id);
    } else {
      id = nanoid();
      const insertStmt = this.db.prepare(
        'INSERT INTO summaries (id, conversation_id, summary, last_message_order, pre_compact_token_count, anchor_message_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      insertStmt.run(
        id,
        conversationId,
        summary,
        lastMessageOrder,
        preCompactTokenCount,
        anchor,
        resolvedBranchId
      );
    }

    return this.getSummaryById(id)!;
  }

  getSummaryById(id: string): StoredSummary | null {
    const stmt = this.db.prepare('SELECT * FROM summaries WHERE id = ?');
    const row = stmt.get(id) as SummaryRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getSummaryByConversation(conversationId: string, branchId?: string | null): StoredSummary | null {
    const resolvedBranchId = branchId === undefined ? this.getActiveBranchId(conversationId) : branchId;
    const stmt = resolvedBranchId
      ? this.db.prepare(
          'SELECT * FROM summaries WHERE conversation_id = ? AND branch_id = ? ORDER BY compacted_at DESC LIMIT 1'
        )
      : this.db.prepare(
          'SELECT * FROM summaries WHERE conversation_id = ? AND branch_id IS NULL ORDER BY compacted_at DESC LIMIT 1'
        );
    const row = stmt.get(conversationId, ...(resolvedBranchId ? [resolvedBranchId] : [])) as SummaryRow | undefined;
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
      anchorMessageId: row.anchor_message_id ?? null,
      branchId: row.branch_id ?? null,
    };
  }

  private getActiveBranchId(conversationId: string): string | null {
    const row = this.db.prepare('SELECT active_branch_id FROM conversations WHERE id = ?')
      .get(conversationId) as { active_branch_id: string | null } | undefined;
    return row?.active_branch_id ?? null;
  }
}