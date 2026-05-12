import Database from 'better-sqlite3';

const dbPath = 'E:/thething/packages/server/.siact/data/chat.db';
console.log('Opening database:', dbPath);

const db = new Database(dbPath);

try {
  // Check current table structure
  const tableInfo = db.prepare('PRAGMA table_info(pending_approvals)').all();
  console.log('Current columns:', tableInfo.map(c => c.name));

  // Drop and recreate with correct schema (no expires_at)
  db.exec('DROP TABLE IF EXISTS pending_approvals');
  console.log('Dropped old table');

  db.exec(`
    CREATE TABLE pending_approvals (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      connector_type TEXT NOT NULL,
      channel_id TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_approvals_conversation ON pending_approvals(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON pending_approvals(status);
  `);
  console.log('Created new table with correct schema');

  // Verify new structure
  const newInfo = db.prepare('PRAGMA table_info(pending_approvals)').all();
  console.log('New columns:', newInfo.map(c => c.name));

  // Update schema version
  db.pragma('user_version = 3');
  console.log('Schema version set to 3');

} catch (e: any) {
  console.error('Error:', e.message);
}

db.close();
console.log('Done');