import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// SQLite database path - store in project root as .data/chat.db
const DB_PATH = path.join(process.cwd(), ".data", "chat.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    // Ensure the .data directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);

    // Enable WAL mode for better concurrent read performance
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    initializeSchema(db);
  }

  return db;
}

function initializeSchema(database: Database.Database): void {
  database.exec(`
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

    -- Memory metadata index table
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL CHECK(owner_type IN ('user', 'team', 'project')),
      owner_id TEXT NOT NULL,
      memory_type TEXT NOT NULL CHECK(memory_type IN ('user', 'feedback', 'project', 'reference')),
      name TEXT NOT NULL,
      description TEXT,
      file_path TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      recall_count INTEGER DEFAULT 0,
      last_recalled_at TEXT
    );

    -- Memory usage tracking table
    CREATE TABLE IF NOT EXISTS memory_usage (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      conversation_id TEXT,
      recalled_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- Indexes for memory queries
    CREATE INDEX IF NOT EXISTS idx_memories_owner
      ON memories(owner_type, owner_id);

    CREATE INDEX IF NOT EXISTS idx_memories_type
      ON memories(memory_type, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_memory_usage_memory
      ON memory_usage(memory_id, recalled_at DESC);

    -- MCP server configurations
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      transport_type TEXT NOT NULL CHECK(transport_type IN ('sse', 'http', 'stdio')),
      url TEXT,
      headers TEXT,
      command TEXT,
      args TEXT,
      env TEXT,
      tools_include TEXT,
      tools_exclude TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
