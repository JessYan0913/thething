// ============================================================
// SQLite Schema Initialization
// ============================================================
// Database schema for conversations, messages, summaries, and costs.
// Memory is stored in file system (.thething/memory/), not in database.

import type { SqliteDatabase } from '../../types/sqlite';

/**
 * Initialize the database schema.
 * Creates all tables and indexes if they don't exist.
 */
export function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    -- Conversations table
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT 'New Conversation',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- Index for efficient message retrieval by conversation
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, "order");

    -- Index for conversation ordering
    CREATE INDEX IF NOT EXISTS idx_conversations_updated
      ON conversations(updated_at DESC);

    -- Summaries table for session memory compaction
    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      compacted_at TEXT DEFAULT (datetime('now')),
      last_message_order INTEGER NOT NULL,
      pre_compact_token_count INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- Index for efficient summary lookup
    CREATE INDEX IF NOT EXISTS idx_summaries_conversation
      ON summaries(conversation_id, compacted_at DESC);
  `);
}

/**
 * Initialize the cost tracking schema (separate table, may be created later)
 */
export function initializeCostSchema(db: SqliteDatabase): void {
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
}