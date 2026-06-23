// ============================================================
// SQLite Schema Initialization
// ============================================================
// Database schema for conversations, messages, summaries, costs, and todos.
// Memory is stored in file system (.siact/memory/), not in database.

import type { SqliteDatabase } from '../../../primitives/datastore/types';
import { logger } from '../../../primitives/logger';

const SCHEMA_VERSION = 6;

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
    // v2: add todos table
    db.exec(`
      -- Todos table for todo management system
      CREATE TABLE IF NOT EXISTS todos (
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

      -- Index for todo lookup by conversation
      CREATE INDEX IF NOT EXISTS idx_todos_conversation
        ON todos(conversation_id);

      -- Index for todo status lookup
      CREATE INDEX IF NOT EXISTS idx_todos_status
        ON todos(status);

      -- Index for claimed todos lookup
      CREATE INDEX IF NOT EXISTS idx_todos_claimed
        ON todos(claimed_by);
    `);
    logger.debug('Schema', 'Migrated to v2: added todos table');
  }

  if (currentVersion < 3) {
    // v3: add pending_approvals table for Connector mode
    db.exec(`
      -- Pending approvals table for Connector mode
      CREATE TABLE IF NOT EXISTS pending_approvals (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'denied', 'expired')),
        created_at TEXT DEFAULT (datetime('now')),
        connector_type TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      -- Index for approval lookup by conversation
      CREATE INDEX IF NOT EXISTS idx_approvals_conversation
        ON pending_approvals(conversation_id);

      -- Index for approval status lookup
      CREATE INDEX IF NOT EXISTS idx_approvals_status
        ON pending_approvals(status);
    `);
    logger.debug('Schema', 'Migrated to v3: added pending_approvals table');
  }

  if (currentVersion < 4) {
    // v4: rename tasks → todos (destructive, zero users)
    db.exec(`
      DROP TABLE IF EXISTS tasks;
      DROP INDEX IF EXISTS idx_tasks_conversation;
      DROP INDEX IF EXISTS idx_tasks_status;
      DROP INDEX IF EXISTS idx_tasks_claimed;

      CREATE TABLE IF NOT EXISTS todos (
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

      CREATE INDEX IF NOT EXISTS idx_todos_conversation ON todos(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
      CREATE INDEX IF NOT EXISTS idx_todos_claimed ON todos(claimed_by);
    `);
    logger.debug('Schema', 'Migrated to v4: renamed tasks to todos');
  }

  if (currentVersion < 5) {
    // v5: add source tracking columns to conversations
    // Use try-catch per ALTER TABLE to handle case where columns already exist from a partial prior run
    for (const col of ['source TEXT DEFAULT \'user\'', 'source_id TEXT DEFAULT NULL', 'channel_id TEXT DEFAULT NULL']) {
      try {
        db.exec(`ALTER TABLE conversations ADD COLUMN ${col}`);
      } catch (e: any) {
        if (!e.message?.includes('duplicate column name')) throw e;
      }
    }

    // Populate source fields from existing compound IDs
    db.exec(`
      UPDATE conversations SET
        source = 'connector',
        source_id = SUBSTR(id, INSTR(id, 'connector:') + 10, INSTR(SUBSTR(id, INSTR(id, 'connector:') + 10), ':channel:') - 1),
        channel_id = SUBSTR(id, INSTR(id, ':channel:') + 9)
      WHERE id LIKE 'connector:%:channel:%'
    `);

    // Mark conversations that look like cron jobs
    db.exec(`
      UPDATE conversations SET source = 'cron'
      WHERE id LIKE 'connector:__cron__:channel:%'
    `);

    // Update cron source_id extraction
    db.exec(`
      UPDATE conversations SET
        source_id = SUBSTR(channel_id, 6, INSTR(channel_id || '-', '-') - 1)
      WHERE source = 'cron' AND channel_id LIKE 'cron-%'
    `);

    logger.debug('Schema', 'Migrated to v5: added source/source_id/channel_id columns');
  }

  if (currentVersion < 6) {
    // v6: add projects table and project_id to conversations
    db.exec(`
      -- Projects table
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Add project_id to conversations
      ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id);
    `);

    logger.debug('Schema', 'Migrated to v6: added projects table and project_id column');
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
    -- Conversations table (base v1 schema; v5 adds source/source_id/channel_id, v6 adds project_id)
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

    -- Todos table
    CREATE TABLE IF NOT EXISTS todos (
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

    CREATE INDEX IF NOT EXISTS idx_todos_conversation ON todos(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
    CREATE INDEX IF NOT EXISTS idx_todos_claimed ON todos(claimed_by);
  `);

  ensureSchemaVersion(db);
}