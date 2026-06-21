// ============================================================
// SQLite Conversation Store Implementation
// ============================================================

import type { SqliteDatabase } from '../../../primitives/datastore/types';
import type { ConversationStore, Conversation, ConversationRow } from '../../../primitives/datastore/types';

/**
 * SQLite-based ConversationStore implementation
 */
export class SQLiteConversationStore implements ConversationStore {
  constructor(private db: SqliteDatabase) {}

  createConversation(id: string, title?: string, metadata?: { source?: string; sourceId?: string; channelId?: string; projectId?: string }): Conversation {
    const stmt = this.db.prepare(
      'INSERT INTO conversations (id, title, source, source_id, channel_id, project_id) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(
      id,
      title || 'New Conversation',
      metadata?.source || 'user',
      metadata?.sourceId || null,
      metadata?.channelId || null,
      metadata?.projectId || null
    );
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
      source: row.source,
      sourceId: row.source_id,
      channelId: row.channel_id,
      projectId: row.project_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listConversationsByProject(projectId: string): Conversation[] {
    const stmt = this.db.prepare(
      'SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC'
    );
    const rows = stmt.all(projectId) as unknown as ConversationRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listConversationsWithoutProject(): Conversation[] {
    const stmt = this.db.prepare(
      'SELECT * FROM conversations WHERE project_id IS NULL ORDER BY updated_at DESC'
    );
    const rows = stmt.all() as unknown as ConversationRow[];
    return rows.map((row) => this.mapRow(row));
  }
}