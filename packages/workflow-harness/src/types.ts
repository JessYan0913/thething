// ============================================================
// Workflow Harness Types
// ============================================================
// Durable agent state and slice execution types.
// Modeled after @ai-sdk/workflow-harness but self-contained.

import type { UIMessage, UIMessageChunk } from 'ai';

// ============================================================
// Status State Machine
// ============================================================

export type DurableAgentStatus =
  | 'running'
  | 'timed_out'
  | 'awaiting_approval'
  | 'finished'
  | 'failed';

// ============================================================
// Serialized Stream Chunk
// ============================================================

/** A JSON-serializable stream chunk for cross-slice replay. */
export interface SerializedChunk {
  type: string;
  [key: string]: unknown;
}

// ============================================================
// Stream Context
// ============================================================

/**
 * Tracks "open" UI message parts across slice boundaries.
 * When a slice times out mid-stream, text-start may have been
 * written without a corresponding text-end. The next slice
 * replays these as prelude chunks.
 */
export interface StreamContext {
  /** text-start chunks written but not yet closed by text-end */
  activeTextParts?: Record<string, SerializedChunk>;
  /** reasoning-start chunks written but not yet closed by reasoning-end */
  activeReasoningParts?: Record<string, SerializedChunk>;
  /** tool-input-start chunks written but not yet closed */
  pendingToolInputs?: Record<string, SerializedChunk>;
}

// ============================================================
// Durable Agent State
// ============================================================

/**
 * Pure JSON-serializable agent state. No class instances, no Promises.
 * Stored in SQLite between slices. The orchestrator owns persistence.
 */
export interface DurableAgentState {
  conversationId: string;
  status: DurableAgentStatus;
  /**
   * Accumulated UIMessage[] at the last step boundary.
   * Passed back to createAgentUIStream as uiMessages on resume.
   */
  accumulatedMessages: UIMessage[];
  /** Stream context for cross-slice part tracking */
  streamContext?: StreamContext;
  /** Messages pending approval response */
  pendingMessages?: UIMessage[];
  /** Number of completed steps */
  stepCount: number;
  /** Tool names used so far */
  toolsUsed: string[];
  /** Error message if failed */
  error?: string;
  startedAt: string;
  updatedAt: string;
}

// ============================================================
// Slice Execution
// ============================================================

/**
 * Factory that creates the UI message stream.
 * Wraps createAgentUIStream() from the AI SDK.
 * The onStep callback MUST be forwarded to enable step-boundary checkpointing.
 */
export type StreamFactory = (options: {
  messages: UIMessage[];
  abortSignal: AbortSignal;
  onStep: (event: { messages: UIMessage[] }) => void;
}) => Promise<AsyncIterable<UIMessageChunk>>;

/** Options for a single slice execution. */
export interface SliceOptions {
  /** Factory that creates the agent UI stream */
  createStream: StreamFactory;
  /** Current durable state (may contain resume data) */
  state: DurableAgentState;
  /** Original UI messages for this conversation turn */
  messages: UIMessage[];
  /** Slice wall-clock timeout in ms. Default: 300000 (5 min) */
  sliceTimeoutMs?: number;
  /** Writable stream for real-time chunk output */
  writable?: WritableStream<UIMessageChunk>;
  /** External abort signal */
  abortSignal?: AbortSignal;
  /** Called for each chunk emitted by the agent */
  onChunk?: (chunk: UIMessageChunk) => void;
  /**
   * Called when a step boundary is reached (after tool execution).
   * Use this to persist intermediate state.
   * The state's modelMessages will be updated with the latest messages.
   */
  onStepComplete?: (state: DurableAgentState) => void;
}

/** Result of a single slice execution. */
export interface SliceResult {
  /** Updated durable state after this slice */
  state: DurableAgentState;
  /** All chunks emitted during this slice */
  chunks: UIMessageChunk[];
}

// ============================================================
// Agent State Store (interface for persistence)
// ============================================================

/**
 * Abstract storage interface. Implementations: SQLite, in-memory, etc.
 * The workflow package provides the SQLite implementation.
 */
export interface AgentStateStore {
  getState(conversationId: string): DurableAgentState | null;
  saveState(state: DurableAgentState): void;
  updateStatus(conversationId: string, status: DurableAgentStatus): void;
  clearState(conversationId: string): void;
  getRunningStates(): DurableAgentState[];
}

// ============================================================
// Helpers
// ============================================================

export function createFreshState(conversationId: string): DurableAgentState {
  return {
    conversationId,
    status: 'running',
    accumulatedMessages: [],
    stepCount: 0,
    toolsUsed: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function isResumable(status: DurableAgentStatus): boolean {
  return status === 'running' || status === 'timed_out';
}
