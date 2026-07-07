// ============================================================
// SQLite SuspendedStateStore Implementation
// ============================================================
// Provides durable persistence for suspended agent states
// to enable cross-restart approval recovery.

import type { SqliteDatabase, SqliteStatement, SuspendedStateStore } from '../../../primitives/datastore/types';

interface SuspendedStateRow {
  conversation_id: string;
  suspended_state: string;
  created_at: string;
  expires_at: string;
}

function mapRow(row: SuspendedStateRow): { state: string; createdAt: Date; expiresAt: Date } {
  return {
    state: row.suspended_state,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  };
}

export class SQLiteSuspendedStateStore implements SuspendedStateStore {
  private insertState: SqliteStatement;
  private getStateStmt: SqliteStatement;
  private clearStateStmt: SqliteStatement;
  private getConversationsStmt: SqliteStatement;
  private cleanupStmt: SqliteStatement;

  constructor(private db: SqliteDatabase) {
    this.insertState = db.prepare(`
      INSERT OR REPLACE INTO suspended_agent_states (conversation_id, suspended_state, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);

    this.getStateStmt = db.prepare(`
      SELECT * FROM suspended_agent_states WHERE conversation_id = ?
    `);

    this.clearStateStmt = db.prepare(`
      DELETE FROM suspended_agent_states WHERE conversation_id = ?
    `);

    this.getConversationsStmt = db.prepare(`
      SELECT conversation_id FROM suspended_agent_states WHERE expires_at > datetime('now')
    `);

    this.cleanupStmt = db.prepare(`
      DELETE FROM suspended_agent_states WHERE expires_at <= datetime('now')
    `);
  }

  saveSuspendedState(conversationId: string, state: string, createdAt: Date, expiresAt: Date): void {
    this.insertState.run(conversationId, state, createdAt.toISOString(), expiresAt.toISOString());
  }

  getSuspendedState(conversationId: string): { state: string; createdAt: Date; expiresAt: Date } | null {
    const row = this.getStateStmt.get(conversationId) as SuspendedStateRow | undefined;
    if (!row) return null;
    
    const mapped = mapRow(row);
    // Check if expired
    if (mapped.expiresAt <= new Date()) {
      this.clearSuspendedState(conversationId);
      return null;
    }
    
    return mapped;
  }

  clearSuspendedState(conversationId: string): void {
    this.clearStateStmt.run(conversationId);
  }

  getConversationsWithSuspendedStates(): string[] {
    const rows = this.getConversationsStmt.all() as { conversation_id: string }[];
    return rows.map(row => row.conversation_id);
  }

  cleanupExpiredStates(): number {
    const result = this.cleanupStmt.run();
    return result.changes;
  }
}
