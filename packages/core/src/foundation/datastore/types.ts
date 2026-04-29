// ============================================================
// Data Storage Abstraction Layer Types
// ============================================================
// Core interfaces for persisting conversation data, messages, summaries,
// and costs. Designed to allow developers to replace SQLite
// with custom implementations (PostgreSQL, MongoDB, etc).

import type { UIMessage } from 'ai';

// ============================================================================
// SQLite Native Types (for better-sqlite3 interface)
// ============================================================================

/**
 * Statement 对象接口 - prepared statement
 */
export interface SqliteStatement {
  run(...params: unknown[]): SqliteStatement;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[] | undefined[];
  iterate(...params: unknown[]): IterableIterator<Record<string, unknown> | undefined>;
  bind(...params: unknown[]): SqliteStatement;
  pluck(toggle?: boolean): SqliteStatement;
  expand(toggle?: boolean): SqliteStatement;
  raw(toggle?: boolean): SqliteStatement;
  columns(): Array<{ name: string; column: unknown; table: string; database: string; type: string }>;
}

/**
 * Database 对象接口 - SQLite 数据库连接
 */
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  pragma(sql: string, simplify?: boolean): unknown;
  exec(sql: string): SqliteDatabase;
  backup(destination: string, options?: {
    progress?: (progress: { totalPages: number; remainingPages: number }) => void;
  }): Promise<void>;
  close(): void;

  // Properties
  readonly open: boolean;
  readonly inTransaction: boolean;
  readonly readonly: boolean;
}

/**
 * Database 构造函数选项
 */
export interface SqliteDatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
  verbose?: (message: unknown) => void;
}

/**
 * Database 构造函数类型
 */
export interface SqliteDatabaseConstructor {
  new (filename: string, options?: SqliteDatabaseOptions): SqliteDatabase;
}

// ============================================================================
// Data Models
// ============================================================================

/**
 * Conversation entity
 */
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stored message entity ( persisted form of UIMessage)
 */
export interface StoredMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string; // JSON string of UIMessage
  order: number;
  createdAt: string;
}

/**
 * Summary entity for session memory compaction
 */
export interface StoredSummary {
  id: string;
  conversationId: string;
  summary: string;
  compactedAt: string;
  lastMessageOrder: number;
  preCompactTokenCount: number;
}

/**
 * Cost record entity for tracking API costs
 */
export interface CostRecord {
  id: string;
  conversationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Sub-Store Interfaces (Composable design)
// ============================================================================

/**
 * Conversation storage interface
 */
export interface ConversationStore {
  /**
   * Create a new conversation
   */
  createConversation(id: string, title?: string): Conversation;

  /**
   * Get a conversation by ID
   */
  getConversation(id: string): Conversation | null;

  /**
   * List all conversations, ordered by most recently updated
   */
  listConversations(): Conversation[];

  /**
   * Update conversation title
   */
  updateConversationTitle(id: string, title: string): void;

  /**
   * Delete a conversation and all associated data
   */
  deleteConversation(id: string): void;
}

/**
 * Message storage interface
 */
export interface MessageStore {
  /**
   * Get all messages for a conversation
   */
  getMessagesByConversation(conversationId: string): UIMessage[];

  /**
   * Save messages for a conversation.
   *
   * **Semantics: full replacement**. This method deletes all existing messages
   * for the given conversationId, then re-inserts the provided messages list.
   * It is NOT an incremental append — callers must pass the complete message history.
   *
   * For large conversations (100+ messages), implementations should wrap this
   * in a transaction for atomicity.
   */
  saveMessages(conversationId: string, messages: UIMessage[]): void;

  /**
   * Get the next order number for a conversation
   */
  getNextMessageOrder(conversationId: string): number;
}

/**
 * Summary storage interface (for session memory compaction)
 */
export interface SummaryStore {
  /**
   * Save or update a summary for a conversation
   */
  saveSummary(
    conversationId: string,
    summary: string,
    lastMessageOrder: number,
    preCompactTokenCount: number
  ): StoredSummary;

  /**
   * Get a summary by ID
   */
  getSummaryById(id: string): StoredSummary | null;

  /**
   * Get the latest summary for a conversation
   */
  getSummaryByConversation(conversationId: string): StoredSummary | null;

  /**
   * Delete all summaries for a conversation
   */
  deleteSummariesByConversation(conversationId: string): void;
}

/**
 * Cost tracking storage interface
 */
export interface CostStore {
  /**
   * Save or update a cost record for a conversation
   */
  saveCostRecord(params: {
    conversationId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    totalCostUsd: number;
  }): CostRecord;

  /**
   * Get cost record for a conversation
   */
  getCostByConversation(conversationId: string): CostRecord | null;

  /**
   * Update cost record for a conversation
   */
  updateCostByConversation(
    conversationId: string,
    params: {
      inputTokens: number;
      outputTokens: number;
      cachedReadTokens: number;
      totalCostUsd: number;
    }
  ): void;
}

// ============================================================================
// Unified DataStore Interface
// ============================================================================

/**
 * Unified data store interface - aggregates all sub-stores.
 *
 * Note: Memory storage is handled by the file-based memory system
 * in .siact/memory/, not by DataStore.
 *
 * Developers can:
 * 1. Replace entire DataStore with custom implementation
 * 2. Replace individual sub-stores while keeping others as SQLite
 *
 * @example Full replacement
 * ```typescript
 * const runtime = await bootstrap({ dataDir: './data' });
 * const customStore: DataStore = new MyCustomDataStore();
 * ```
 *
 * @example Partial replacement (mix SQLite with custom)
 * ```typescript
 * const sqliteStore = createSQLiteDataStore(config);
 * const customStore: DataStore = {
 *   ...sqliteStore,
 *   conversationStore: new PostgresConversationStore(),
 * };
 * ```
 */
export interface DataStore {
  /** Conversation storage */
  conversationStore: ConversationStore;

  /** Message storage */
  messageStore: MessageStore;

  /** Summary storage */
  summaryStore: SummaryStore;

  /** Cost tracking storage */
  costStore: CostStore;

  /**
   * Execute a function within a database transaction.
   * SQLite implementation uses db.transaction();
   * remote implementations (e.g. PostgreSQL) can use BEGIN/COMMIT;
   * implementations without transaction support may invoke the callback directly (degraded mode).
   */
  transaction<T>(fn: () => T): T;

  /**
   * Backup the database to a destination file.
   * For non-SQLite implementations, this may fall back to file copy.
   */
  backup(destination: string): Promise<void>;

  /**
   * Close all connections
   */
  close(): void;

  /**
   * Check if the store is connected
   */
  isConnected(): boolean;
}

/**
 * Configuration for SQLite data store
 */
export interface SQLiteDataStoreConfig {
  /** Data directory containing chat.db. Defaults to process.cwd() + '/.data' */
  dataDir?: string;
}

// ============================================================================
// Internal Row Types (for SQLite mapping)
// ============================================================================

export interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  order: number;
  created_at: string;
}

export interface SummaryRow {
  id: string;
  conversation_id: string;
  summary: string;
  compacted_at: string;
  last_message_order: number;
  pre_compact_token_count: number;
}

export interface CostRow {
  id: string;
  conversation_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_read_tokens: number;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
}