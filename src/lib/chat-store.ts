import type { UIMessage } from "ai";
import { nanoid } from "nanoid";
import { getDb } from "./db";

// ============================================================================
// Types
// ============================================================================

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string; // JSON string of UIMessage
  order: number;
  createdAt: string;
}

// ============================================================================
// Conversation CRUD
// ============================================================================

export function createConversation(id: string, title?: string): Conversation {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO conversations (id, title) VALUES (?, ?)"
  );
  stmt.run(id, title || "New Conversation");
  return getConversation(id)!;
}

export function getConversation(id: string): Conversation | null {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM conversations WHERE id = ?");
  const row = stmt.get(id) as
    | { id: string; title: string; created_at: string; updated_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listConversations(): Conversation[] {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT * FROM conversations ORDER BY updated_at DESC"
  );
  const rows = stmt.all() as Array<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function updateConversationTitle(id: string, title: string): void {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
  );
  stmt.run(title, id);
}

export function deleteConversation(id: string): void {
  const db = getDb();
  // Foreign key CASCADE will delete associated messages
  const stmt = db.prepare("DELETE FROM conversations WHERE id = ?");
  stmt.run(id);
}

// ============================================================================
// Message CRUD
// ============================================================================

export function getMessagesByConversation(conversationId: string): UIMessage[] {
  const db = getDb();
  const stmt = db.prepare(
    'SELECT content FROM messages WHERE conversation_id = ? ORDER BY "order" ASC'
  );
  const rows = stmt.all(conversationId) as { content: string }[];
  return rows.map((row) => JSON.parse(row.content) as UIMessage);
}

/**
 * Save messages for a conversation.
 *
 * Strategy: Delete all existing messages for the conversation first, then
 * re-insert the provided messages. This ensures the database stays in sync
 * with the frontend state, especially after operations like "regenerate"
 * where the assistant message ID may change.
 *
 * Also updates the conversation's updated_at timestamp.
 */
export function saveMessages(
  conversationId: string,
  messages: UIMessage[]
): void {
  const db = getDb();

  // Ensure conversation exists
  const existing = getConversation(conversationId);
  if (!existing) {
    // Auto-generate title from first user message
    const firstUserMessage = messages.find((m) => m.role === "user");
    const title = firstUserMessage
      ? firstUserMessage.parts
          .filter((p) => p.type === "text")
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("")
          .slice(0, 50) || "New Conversation"
      : "New Conversation";
    createConversation(conversationId, title);
  }

  const insertStmt = db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, "order") VALUES (?, ?, ?, ?, ?)'
  );
  const deleteStmt = db.prepare(
    "DELETE FROM messages WHERE conversation_id = ?"
  );
  const updateConversationStmt = db.prepare(
    "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
  );

  const transaction = db.transaction(() => {
    // Delete all existing messages for this conversation first
    deleteStmt.run(conversationId);

    // Re-insert all messages with fresh order numbers
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // Auto-generate ID for messages without one (e.g., assistant messages from ToolLoopAgent)
      const stableId = msg.id || nanoid();
      // Ensure the in-memory object also gets the ID so JSON is consistent
      if (!msg.id) {
        msg.id = stableId;
      }
      insertStmt.run(
        stableId,
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

/**
 * Get the next order number for a conversation.
 */
export function getNextMessageOrder(conversationId: string): number {
  const db = getDb();
  const stmt = db.prepare(
    'SELECT MAX("order") as maxOrder FROM messages WHERE conversation_id = ?'
  );
  const result = stmt.get(conversationId) as { maxOrder: number | null };
  return (result.maxOrder ?? -1) + 1;
}
