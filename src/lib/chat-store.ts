import { generateText } from "ai";
import type { UIMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { nanoid } from "nanoid";
import { getDb } from "./db";

const dashscope = createOpenAICompatible({
  name: "dashscope",
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
});

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

export interface StoredSummary {
  id: string;
  conversationId: string;
  summary: string;
  compactedAt: string;
  lastMessageOrder: number;
  preCompactTokenCount: number;
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
  deleteSummariesByConversation(id);
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
    // Auto-generate title from first user message (fallback before AI generation)
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

    // First pass: assign IDs to messages that don't have one
    const messagesWithIds = messages.map((msg) => ({
      ...msg,
      id: msg.id || nanoid(),
    }));

    // Deduplicate by id, keeping the last occurrence
    const seenIds = new Set<string>();
    const deduped = messagesWithIds.filter((msg) => {
      if (seenIds.has(msg.id)) {
        console.warn(`[ChatStore] Deduplicating message with duplicate id: ${msg.id}, role: ${msg.role}`);
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

// ============================================================================
// AI Title Generation
// ============================================================================

/**
 * Generate a concise title for a conversation using the LLM via AI SDK generateText.
 * Runs asynchronously so it never blocks the main response stream.
 */
export async function generateConversationTitle(
  messages: UIMessage[]
): Promise<string> {
  const firstUserMessage = messages.find((m) => m.role === "user");
  const firstAssistantMessage = messages.find((m) => m.role === "assistant");

  // Fallback: extract first meaningful text from user message
  const fallbackTitle = (firstUserMessage
    ? firstUserMessage.parts
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("")
        .trim()
        .slice(0, 50)
    : "New Conversation") || "New Conversation";

  try {
    const userText = firstUserMessage?.parts
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();

    const assistantText = firstAssistantMessage?.parts
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();

    if (!userText) return fallbackTitle;

    const { text } = await generateText({
      model: dashscope(process.env.DASHSCOPE_MODEL!),
      system:
        "你是一个对话标题生成助手。请根据用户的首条消息和AI的回复，生成一个简洁、准确的对话标题。",
      prompt: `用户消息: ${userText.slice(0, 300)}\n${
        assistantText ? `AI回复: ${assistantText.slice(0, 300)}` : ""
      }\n\n要求:\n- 不超过15个字符\n- 准确反映对话核心主题\n- 不要使用引号、书名号等特殊符号\n- 只输出标题文本本身，不要任何其他内容`,
      maxOutputTokens: 50,
      temperature: 0.3,
    });

    const title = text.trim();
    if (!title) return fallbackTitle;

    // Clean up: remove common quote/bracket chars, limit length
    const cleaned = title.replace(/^["'《（(【\s]+|[》）)】\s]+$/g, "").trim();
    return cleaned.slice(0, 15) || fallbackTitle;
  } catch {
    return fallbackTitle;
  }
}

// ============================================================================
// Summary Storage for Compaction
// ============================================================================

export function saveSummary(
  conversationId: string,
  summary: string,
  lastMessageOrder: number,
  preCompactTokenCount: number
): StoredSummary {
  const db = getDb();
  
  const existing = getSummaryByConversation(conversationId);
  
  let id: string;
  
  if (existing) {
    id = existing.id;
    const updateStmt = db.prepare(
      "UPDATE summaries SET summary = ?, last_message_order = ?, pre_compact_token_count = ?, compacted_at = CURRENT_TIMESTAMP WHERE id = ?"
    );
    updateStmt.run(summary, lastMessageOrder, preCompactTokenCount, id);
  } else {
    id = nanoid();
    const insertStmt = db.prepare(
      "INSERT INTO summaries (id, conversation_id, summary, last_message_order, pre_compact_token_count) VALUES (?, ?, ?, ?, ?)"
    );
    insertStmt.run(id, conversationId, summary, lastMessageOrder, preCompactTokenCount);
  }

  return getSummaryById(id)!;
}

export function getSummaryById(id: string): StoredSummary | null {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM summaries WHERE id = ?");
  const row = stmt.get(id) as StoredSummaryRow | undefined;
  return row ? mapSummaryRow(row) : null;
}

export function getSummaryByConversation(conversationId: string): StoredSummary | null {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT * FROM summaries WHERE conversation_id = ? ORDER BY compacted_at DESC LIMIT 1"
  );
  const row = stmt.get(conversationId) as StoredSummaryRow | undefined;
  return row ? mapSummaryRow(row) : null;
}

export function deleteSummariesByConversation(conversationId: string): void {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM summaries WHERE conversation_id = ?");
  stmt.run(conversationId);
}

interface StoredSummaryRow {
  id: string;
  conversation_id: string;
  summary: string;
  compacted_at: string;
  last_message_order: number;
  pre_compact_token_count: number;
}

function mapSummaryRow(row: StoredSummaryRow): StoredSummary {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    summary: row.summary,
    compactedAt: row.compacted_at,
    lastMessageOrder: row.last_message_order,
    preCompactTokenCount: row.pre_compact_token_count,
  };
}
