// ============================================================
// Data Storage Abstraction Layer Types
// ============================================================
// Core interfaces for persisting conversation data, messages, summaries,
// and costs. Designed to allow developers to replace SQLite
// with custom implementations (PostgreSQL, MongoDB, etc).

import type { UIMessage } from 'ai';

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
   * Save messages for a conversation (replaces existing messages)
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
   * Ensure the cost table schema exists
   */
  ensureSchema(): void;

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
 * in .thething/memory/, not by DataStore.
 *
 * Developers can:
 * 1. Replace entire DataStore with custom implementation
 * 2. Replace individual sub-stores while keeping others as SQLite
 *
 * @example Full replacement
 * ```typescript
 * setGlobalDataStore(new MyCustomDataStore());
 * ```
 *
 * @example Partial replacement (mix SQLite with custom)
 * ```typescript
 * const sqliteStore = createSQLiteDataStore(config);
 * setGlobalDataStore({
 *   ...sqliteStore,
 *   conversationStore: new PostgresConversationStore(),
 * });
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