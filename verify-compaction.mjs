import Database from "better-sqlite3";

const db = new Database(".data/chat.db", { readonly: false });

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    compacted_at TEXT DEFAULT (datetime('now')),
    last_message_order INTEGER NOT NULL,
    pre_compact_token_count INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_summaries_conversation 
    ON summaries(conversation_id, compacted_at DESC);
`);

console.log("\n========================================");
console.log("  Context Compaction Verification");
console.log("========================================\n");

// Check schema
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Tables found:", tables.map(t => t.name).join(", "));

// Check summaries
const summaryCount = db.prepare("SELECT COUNT(*) as count FROM summaries").get();
console.log("\nSummaries:", summaryCount.count);

if (summaryCount.count > 0) {
  const summaries = db.prepare("SELECT * FROM summaries ORDER BY compacted_at DESC").all();
  console.log("\n--- Summary Details ---");
  summaries.forEach((s, i) => {
    console.log(`\n[${i + 1}] Conversation: ${s.conversation_id}`);
    console.log(`    Compacted At: ${s.compacted_at}`);
    console.log(`    Pre-compact Tokens: ${s.pre_compact_token_count}`);
    console.log(`    Last Message Order: ${s.last_message_order}`);
    console.log(`    Summary Preview: ${s.summary.slice(0, 100)}...`);
  });
} else {
  console.log("\nNo summaries yet. Compression hasn't been triggered.");
  console.log("Send a long conversation (>60K estimated tokens) to trigger it.");
}

// Check conversations with message counts
console.log("\n--- Conversation Stats ---");
const conversations = db.prepare(`
  SELECT c.id, c.title, 
    (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
  FROM conversations c
  ORDER BY c.updated_at DESC
  LIMIT 5
`).all();

if (conversations.length === 0) {
  console.log("  No conversations yet.");
} else {
  conversations.forEach(c => {
    const compacted = summaryCount.count > 0
      ? db.prepare("SELECT COUNT(*) FROM summaries WHERE conversation_id = ?").get(c.id)
      : { count: 0 };
    const compactTag = compacted.count > 0 ? " [compacted]" : "";
    console.log(`  ${c.title}: ${c.message_count} messages${compactTag}`);
  });
}

console.log("\n========================================");
console.log("  Trigger threshold: 60,000 tokens");
console.log("  Compaction layers:");
console.log("    1. MicroCompact (tool output cleanup)");
console.log("    2. Session Memory (existing summary reuse)");
console.log("    3. API Summary (LLM-based)");
console.log("========================================\n");

db.close();
