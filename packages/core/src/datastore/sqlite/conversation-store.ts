// ============================================================
// SQLite Conversation Store Implementation
// ============================================================

import type { SqliteDatabase } from '../types';
import type { ConversationStore, Conversation, ConversationRow } from '../types';

/**
 * SQLite-based ConversationStore implementation
 */
export class SQLiteConversationStore implements ConversationStore {
  constructor(private db: SqliteDatabase) {}

  createConversation(id: string, title?: string): Conversation {
    const stmt = this.db.prepare(
      'INSERT INTO conversations (id, title) VALUES (?, ?)'
    );
    stmt.run(id, title || 'New Conversation');
    return this.getConversation(id)!;
  }

  getConversation(id: string): Conversation | null {
    const stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
    const row = stmt.get(id) as ConversationRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  listConversations(): Conversation[] {
    const stmt = this.db.prepare(
      'SELECT * FROM conversations ORDER BY updated_at DESC'
    );
    const rows = stmt.all() as unknown as ConversationRow[];
    return rows.map((row) => this.mapRow(row));
  }

  updateConversationTitle(id: string, title: string): void {
    const stmt = this.db.prepare(
      'UPDATE conversations SET title = ?, updated_at = datetime(\'now\') WHERE id = ?'
    );
    stmt.run(title, id);
  }

  deleteConversation(id: string): void {
    const stmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');
    stmt.run(id);
  }

  private mapRow(row: ConversationRow): Conversation {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}