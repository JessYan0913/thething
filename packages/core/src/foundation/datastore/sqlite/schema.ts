// ============================================================
// SQLite Schema Initialization
// ============================================================
// Database schema for conversations, messages, summaries, costs, and tasks.
// Memory is stored in file system (.siact/memory/), not in database.

import type { SqliteDatabase } from '../types';

const SCHEMA_VERSION = 2;

/**
 * Ensure the database schema is up-to-date.
 * Uses SQLite's user_version pragma to track schema version.
 * Handles incremental migration for existing databases.
 */
function ensureSchemaVersion(db: SqliteDatabase): void {
  const result = db.pragma('user_version');
  const currentVersion = Array.isArray(result) ? (result[0] as { user_version: number }).user_version : 0;

  if (currentVersion === SCHEMA_VERSION) return;

  if (currentVersion < 1) {
    // v1: initial schema (already created by initializeSchema)
  }

  if (currentVersion < 2) {
    // v2: add tasks table
    db.exec(`
      -- Tasks table for task management system
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
        claimed_by TEXT,
        active_form TEXT,
        blocked_by TEXT NOT NULL DEFAULT '[]',
        blocks TEXT NOT NULL DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      -- Index for task lookup by conversation
      CREATE INDEX IF NOT EXISTS idx_tasks_conversation
        ON tasks(conversation_id);

      -- Index for task status lookup
      CREATE INDEX IF NOT EXISTS idx_tasks_status
        ON tasks(status);

      -- Index for claimed tasks lookup
      CREATE INDEX IF NOT EXISTS idx_tasks_claimed
        ON tasks(claimed_by);
    `);
    console.log('[Schema] Migrated to v2: added tasks table');
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

/**
 * Initialize the database schema.
 * Creates all tables and indexes if they don't exist,
 * then ensures the schema version is up-to-date.
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

    -- Cost tracking table (unified into main schema)
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

    -- Index for cost lookup by conversation
    CREATE INDEX IF NOT EXISTS idx_chat_costs_conversation
      ON chat_costs(conversation_id);
  `);

  ensureSchemaVersion(db);
}