// ============================================================
// SQLite Message Store Implementation
// ============================================================

import type { UIMessage } from 'ai';
import type { SqliteDatabase } from '../../types/sqlite';
import type { MessageStore } from '../types';
import { nanoid } from 'nanoid';
import type { ConversationStore } from '../types';

/**
 * SQLite-based MessageStore implementation
 */
export class SQLiteMessageStore implements MessageStore {
  constructor(
    private db: SqliteDatabase,
    private conversationStore: ConversationStore
  ) {}

  getMessagesByConversation(conversationId: string): UIMessage[] {
    const stmt = this.db.prepare(
      'SELECT content FROM messages WHERE conversation_id = ? ORDER BY "order" ASC'
    );
    const rows = stmt.all(conversationId) as { content: string }[];
    return rows.map((row) => JSON.parse(row.content) as UIMessage);
  }

  saveMessages(conversationId: string, messages: UIMessage[]): void {
    // Ensure conversation exists
    const existing = this.conversationStore.getConversation(conversationId);
    if (!existing) {
      // Auto-generate title from first user message
      const firstUserMessage = messages.find((m) => m.role === 'user');
      const title = firstUserMessage
        ? firstUserMessage.parts
            .filter((p) => p.type === 'text')
            .map((p) => (p.type === 'text' ? p.text : ''))
            .join('')
            .slice(0, 50) || 'New Conversation'
        : 'New Conversation';
      this.conversationStore.createConversation(conversationId, title);
    }

    const insertStmt = this.db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, "order") VALUES (?, ?, ?, ?, ?)'
    );
    const deleteStmt = this.db.prepare(
      'DELETE FROM messages WHERE conversation_id = ?'
    );
    const updateConversationStmt = this.db.prepare(
      'UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?'
    );

    const transaction = this.db.transaction(() => {
      // Delete all existing messages for this conversation first
      deleteStmt.run(conversationId);

      // First pass: assign IDs to messages that don't have one
      const messagesWithIds = messages.map((msg) => ({
        ...msg,
        id: msg.id || nanoid(),
      }));

      // Deduplicate by id, keeping the last occurrence
      const seenIds = new Set<string>();
      const deduped = messagesWithIds.filter((msg) => {
        if (seenIds.has(msg.id)) {
          console.warn(
            `[MessageStore] Deduplicating message with duplicate id: ${msg.id}, role: ${msg.role}`
          );
          return false;
        }
        seenIds.add(msg.id);
        return true;
      });

      // Re-insert all messages with fresh order numbers
      for (let i = 0; i < deduped.length; i++) {
        const msg = deduped[i];
        insertStmt.run(
          msg.id,
          conversationId,
          msg.role,
          JSON.stringify(msg),
          i
        );
      }
      updateConversationStmt.run(conversationId);
    });

    transaction();
  }

  getNextMessageOrder(conversationId: string): number {
    const stmt = this.db.prepare(
      'SELECT MAX("order") as maxOrder FROM messages WHERE conversation_id = ?'
    );
    const result = stmt.get(conversationId) as { maxOrder: number | null };
    return (result.maxOrder ?? -1) + 1;
  }
}