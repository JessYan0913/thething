// ============================================================
// Data Storage Abstraction Layer Types
// ============================================================
// Core interfaces for persisting conversation data, messages, summaries,
// and costs. Designed to allow developers to replace SQLite
// with custom implementations (PostgreSQL, MongoDB, etc).

import type { UIMessage } from 'ai';

// Re-export TodoStore for convenience

// ============================================================================
// SQLite Native Types (for better-sqlite3 interface)
// ============================================================================

/**
 * run() 返回结果
 */
export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

/**
 * Statement 对象接口 - prepared statement
 */
export interface SqliteStatement {
  run(...params: unknown[]): RunResult;
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
  source: string;
  sourceId: string | null;
  channelId: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Project entity
 */
export interface Project {
  id: string;
  name: string;
  path: string;
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
  /** compaction checkpoint 锚点:摘要覆盖到的最后一条消息 id(稳定,不随 order 重排)。可空 */
  anchorMessageId?: string | null;
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
  createConversation(id: string, title?: string, metadata?: { source?: string; sourceId?: string; channelId?: string; projectId?: string }): Conversation;

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

  /**
   * List conversations filtered by project
   */
  listConversationsByProject(projectId: string): Conversation[];

  /**
   * List conversations with no project
   */
  listConversationsWithoutProject(): Conversation[];
}

/**
 * Message storage interface
 */
export interface MessageStore {
  /**
   * Get the active message path for a conversation:
   * walk from conversations.head_message_id up the parent chain to the root.
   * Messages on abandoned branches (regenerate/edit) are not returned.
   */
  getMessagesByConversation(conversationId: string): UIMessage[];

  /**
   * Commit a user message, handling all three send semantics by id/content:
   * - id unknown          → normal send: insert as child of head, move head
   * - id known, same parts → regenerate: move head back to that node (no insert)
   * - id known, new parts  → edit-resend: insert a NEW sibling node (fresh id)
   *                          under the same parent, move head to it
   * Invalidates the compaction summary if its anchor leaves the active path.
   * @returns the id of the message now at head (differs from message.id on edit)
   */
  commitUserMessage(conversationId: string, message: UIMessage): string;

  /**
   * Append a chain of messages as descendants of `afterMessageId`
   * (defaults to current head). Rows are always inserted (immutable tree);
   * head only moves if it still equals the anchor — a compare-and-set that
   * makes stale writes from superseded runs harmless orphan branches.
   * @returns true if head moved (this writer is still current)
   */
  appendMessages(conversationId: string, messages: UIMessage[], afterMessageId?: string): boolean;

  /**
   * Destructively rebuild a conversation as a single linear chain.
   * Dev-tool / CLI semantics only (workbench PATCH, CLI session save) —
   * drops all branches. Never use in the chat runtime paths.
   */
  replaceConversation(conversationId: string, messages: UIMessage[]): void;
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
    preCompactTokenCount: number,
    anchorMessageId?: string | null
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
 * Project storage interface
 */
export interface ProjectStore {
  createProject(id: string, name: string, path: string): Project;
  getProject(id: string): Project | null;
  listProjects(): Project[];
  updateProject(id: string, updates: { name?: string; path?: string }): void;
  deleteProject(id: string): void;
}

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

  /** Todo storage (for todo management system) */
  todoStore: TodoStore;

  /** Project storage */
  projectStore: ProjectStore;

  /** Agent run checkpoint storage */
  agentRunStore: AgentRunStore;

  /** Suspended state storage for cross-restart approval recovery */
  suspendedStateStore: SuspendedStateStore;

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


// ============================================================
// Todo Types (data model — used by DataStore interface)
// ============================================================
// These types define the todo data model and TodoStore contract.
// Moved here from runtime/todos/types to eliminate layer inversion.

/**
 * Todo status state machine
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Todo priority levels
 */
export type TodoPriority = 'low' | 'medium' | 'high';

/**
 * Todo metadata for storing additional information
 */
export interface TodoMetadata {
  /** Error message if todo failed */
  error?: string;
  /** Result summary if todo completed */
  result?: string;
  /** Stop reason if todo was stopped */
  stopReason?: string;
  /** Priority level */
  priority?: TodoPriority;
  /** Tags for categorization */
  tags?: string[];
  /** Any additional custom data */
  [key: string]: unknown;
}

/**
 * Core Todo interface
 *
 * Uses doubly-linked list for dependency tracking:
 * - blockedBy: todos that must complete before this todo
 * - blocks: todos that this todo blocks
 */
export interface Todo {
  /** Unique todo identifier (generated by HighWaterMark) */
  id: string;
  /** Conversation ID this todo belongs to */
  conversationId: string;
  /** Todo subject/title */
  subject: string;
  /** Current todo status */
  status: TodoStatus;
  /** Agent ID currently claiming this todo (if in_progress) */
  claimedBy: string | null;
  /** Active form description (what the agent is currently doing) */
  activeForm: string | null;
  /** Todo dependencies - IDs of todos that must complete first */
  blockedBy: string[];
  /** Inverse of blockedBy - IDs of todos this todo blocks */
  blocks: string[];
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Completion timestamp (if completed/failed/cancelled) */
  completedAt: number | null;
  /** Additional metadata */
  metadata: TodoMetadata;
}

/**
 * Input for creating a new todo
 */
export interface TodoCreateInput {
  /** Conversation ID this todo belongs to (required) */
  conversationId: string;
  /** Todo subject/title (required) */
  subject: string;
  /** Initial blockedBy dependencies (optional) */
  blockedBy?: string[];
  /** Initial metadata (optional) */
  metadata?: Partial<TodoMetadata>;
}

/**
 * Input for updating a todo
 */
export interface TodoUpdateInput {
  /** Todo ID to update */
  id: string;
  /** New status (optional) */
  status?: TodoStatus;
  /** New subject (optional) */
  subject?: string;
  /** Active form description (optional) */
  activeForm?: string | null;
  /** Claimed by agent ID (optional) */
  claimedBy?: string | null;
  /** New blockedBy dependencies (optional) */
  blockedBy?: string[];
  /** New metadata (optional, merged with existing) */
  metadata?: Partial<TodoMetadata>;
}

/**
 * Result of claiming a todo
 */
export interface TodoClaimResult {
  /** Whether the claim was successful */
  success: boolean;
  /** The todo if successful */
  todo?: Todo;
  /** Error message if failed */
  message?: string;
}

/**
 * Agent busy status
 */
export interface AgentStatus {
  /** Agent ID */
  agentId: string;
  /** Whether the agent is currently busy */
  isBusy: boolean;
  /** Todo ID currently being worked on (if busy) */
  currentTodoId: string | null;
}

/**
 * Todo event type
 */
export type TodoEventType =
  | 'todo:created'
  | 'todo:updated'
  | 'todo:deleted'
  | 'todo:claimed'
  | 'todo:completed'
  | 'todo:failed'
  | 'todo:cancelled'
  | 'todo:stopped';

/**
 * Todo event payload
 */
export interface TodoEvent {
  type: TodoEventType;
  todo: Todo;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Todo event listener callback
 */
export type TodoEventListener = (event: TodoEvent) => void | Promise<void>;

/**
 * TodoStore interface - defines the contract for todo storage implementations
 */
export interface TodoStore {
  createTodo(input: TodoCreateInput): Todo;
  getTodo(id: string): Todo | undefined;
  getAllTodos(): Todo[];
  getTodosByConversation(conversationId: string): Todo[];
  updateTodo(input: TodoUpdateInput): Todo | undefined;
  deleteTodo(id: string): boolean;
  claimTodo(todoId: string, agentId: string): TodoClaimResult;
  getAvailableTodos(): Todo[];
  getTodosByStatus(status: TodoStatus): Todo[];
  getTodosByAgent(agentId: string): Todo[];
  getBlockingTodos(todoId: string): Todo[];
  getBlockedByTodos(todoId: string): Todo[];
  subscribe(listener: TodoEventListener): () => void;
  getAgentStatus(agentId: string): AgentStatus;
  setAgentBusy(agentId: string, busy: boolean, todoId?: string): void;
  clearAllTodos(): void;
}

// ============================================================
// Agent Run Types (durable execution checkpoint)
// ============================================================

/**
 * Agent run status state machine
 */
export type AgentRunStatus = 'running' | 'paused_approval' | 'completed' | 'failed';

/**
 * Agent run entity — one row per conversation, updated in place
 */
export interface AgentRun {
  conversationId: string;
  status: AgentRunStatus;
  stepCount: number;
  accumulatedText: string;
  toolsUsed: string[];
  error: string | null;
  pendingApprovalId: string | null;
  startedAt: string;
  updatedAt: string;
}

/**
 * Stream chunk entity for cross-restart stream recovery
 */
export interface StreamChunk {
  id: number;
  conversationId: string;
  sequence: number;
  chunkData: string;
  createdAt: string;
}

/**
 * Agent run storage interface — checkpoint + stream persistence
 */
export interface AgentRunStore {
  /** Create or overwrite a run for a conversation */
  createRun(conversationId: string): void;

  /** Update checkpoint fields (step_count, accumulated_text, tools_used) */
  updateRun(conversationId: string, update: {
    stepCount?: number;
    accumulatedText?: string;
    toolsUsed?: string[];
  }): void;

  /** Get the current run for a conversation */
  getRun(conversationId: string): AgentRun | null;

  /** Mark run as completed */
  completeRun(conversationId: string): void;

  /** Mark run as failed */
  failRun(conversationId: string, error: string): void;

  /** Pause run for approval */
  pauseForApproval(conversationId: string, approvalId: string): void;

  /** Resume run from approval */
  resumeFromApproval(conversationId: string): void;

  /** Add a stream chunk */
  addChunk(conversationId: string, sequence: number, data: string): void;

  /** Get stream chunks, optionally from a specific sequence */
  getChunks(conversationId: string, fromSequence?: number): StreamChunk[];

  /** Clear all stream chunks for a conversation */
  clearChunks(conversationId: string): void;
}

/**
 * Suspended agent state storage interface — for cross-restart approval recovery
 */
export interface SuspendedStateStore {
  /** Save suspended state for a conversation */
  saveSuspendedState(conversationId: string, state: string, createdAt: Date, expiresAt: Date): void;

  /** Get suspended state for a conversation */
  getSuspendedState(conversationId: string): { state: string; createdAt: Date; expiresAt: Date } | null;

  /** Clear suspended state for a conversation */
  clearSuspendedState(conversationId: string): void;

  /** Get all conversations with pending suspended states */
  getConversationsWithSuspendedStates(): string[];

  /** Clean up expired suspended states */
  cleanupExpiredStates(): number;
}

export interface ConversationRow {
  id: string;
  title: string;
  source: string;
  source_id: string | null;
  channel_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Project row for SQLite mapping
 */
export interface ProjectRow {
  id: string;
  name: string;
  path: string;
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
  anchor_message_id: string | null;
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

/**
 * Todo row for SQLite mapping
 */
export interface TodoRow {
  id: string;
  conversation_id: string;
  subject: string;
  status: string;
  claimed_by: string | null;
  active_form: string | null;
  blocked_by: string;  // JSON array of todo IDs
  blocks: string;      // JSON array of todo IDs
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: string;    // JSON object
}