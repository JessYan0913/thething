// ============================================================
// SQLite AgentStateStore
// ============================================================
// Persists DurableAgentState for durable workflow execution.
// Stores accumulated ModelMessage[] at each step boundary.

import type { SqliteDatabase, SqliteStatement } from '../../../primitives/datastore/types';

// ============================================================
// Types
// ============================================================

export type DurableAgentStatus =
  | 'running'
  | 'timed_out'
  | 'awaiting_approval'
  | 'finished'
  | 'failed';

/**
 * Pure JSON-serializable agent state.
 * Stored in SQLite between slices.
 */
export interface DurableAgentState {
  conversationId: string;
  status: DurableAgentStatus;
  /** Accumulated ModelMessage[] at last step boundary */
  modelMessages: unknown[];
  /** Stream context for cross-slice part tracking */
  streamContext?: Record<string, unknown>;
  /** Number of completed steps */
  stepCount: number;
  /** Tool names used so far */
  toolsUsed: string[];
  /** Error message if failed */
  error?: string;
  startedAt: string;
  updatedAt: string;
}

export interface AgentStateStore {
  getState(conversationId: string): DurableAgentState | null;
  saveState(state: DurableAgentState): void;
  updateStatus(conversationId: string, status: DurableAgentStatus): void;
  clearState(conversationId: string): void;
  getRunningStates(): DurableAgentState[];
  getRunningConversationIds(): string[];
}

// ============================================================
// SQLite Row
// ============================================================

interface AgentStateRow {
  conversation_id: string;
  status: string;
  model_messages: string;
  stream_context: string | null;
  step_count: number;
  tools_used: string;
  error: string | null;
  started_at: string;
  updated_at: string;
}

function mapRow(row: AgentStateRow): DurableAgentState {
  return {
    conversationId: row.conversation_id,
    status: row.status as DurableAgentStatus,
    modelMessages: JSON.parse(row.model_messages),
    streamContext: row.stream_context ? JSON.parse(row.stream_context) : undefined,
    stepCount: row.step_count,
    toolsUsed: JSON.parse(row.tools_used),
    error: row.error ?? undefined,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Implementation
// ============================================================

export class SQLiteAgentStateStore implements AgentStateStore {
  private getStateStmt: SqliteStatement;
  private insertStateStmt: SqliteStatement;
  private updateStateStmt: SqliteStatement;
  private updateStatusStmt: SqliteStatement;
  private clearStateStmt: SqliteStatement;
  private getRunningStmt: SqliteStatement;
  private getRunningIdsStmt: SqliteStatement;

  constructor(private db: SqliteDatabase) {
    this.getStateStmt = db.prepare(`
      SELECT * FROM agent_states WHERE conversation_id = ?
    `);

    this.insertStateStmt = db.prepare(`
      INSERT OR REPLACE INTO agent_states
        (conversation_id, status, model_messages, stream_context,
         step_count, tools_used, error, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateStateStmt = db.prepare(`
      UPDATE agent_states
      SET status = ?, model_messages = ?, stream_context = ?,
          step_count = ?, tools_used = ?, error = ?, updated_at = datetime('now')
      WHERE conversation_id = ?
    `);

    this.updateStatusStmt = db.prepare(`
      UPDATE agent_states SET status = ?, updated_at = datetime('now')
      WHERE conversation_id = ?
    `);

    this.clearStateStmt = db.prepare(`
      DELETE FROM agent_states WHERE conversation_id = ?
    `);

    this.getRunningStmt = db.prepare(`
      SELECT * FROM agent_states WHERE status IN ('running', 'timed_out', 'awaiting_approval')
    `);

    this.getRunningIdsStmt = db.prepare(`
      SELECT conversation_id FROM agent_states WHERE status IN ('running', 'timed_out', 'awaiting_approval')
    `);
  }

  getState(conversationId: string): DurableAgentState | null {
    const row = this.getStateStmt.get(conversationId) as AgentStateRow | undefined;
    return row ? mapRow(row) : null;
  }

  saveState(state: DurableAgentState): void {
    const existing = this.getStateStmt.get(state.conversationId) as AgentStateRow | undefined;
    if (existing) {
      this.updateStateStmt.run(
        state.status,
        JSON.stringify(state.modelMessages),
        state.streamContext ? JSON.stringify(state.streamContext) : null,
        state.stepCount,
        JSON.stringify(state.toolsUsed),
        state.error ?? null,
        state.conversationId,
      );
    } else {
      this.insertStateStmt.run(
        state.conversationId,
        state.status,
        JSON.stringify(state.modelMessages),
        state.streamContext ? JSON.stringify(state.streamContext) : null,
        state.stepCount,
        JSON.stringify(state.toolsUsed),
        state.error ?? null,
        state.startedAt,
        state.updatedAt,
      );
    }
  }

  updateStatus(conversationId: string, status: DurableAgentStatus): void {
    this.updateStatusStmt.run(status, conversationId);
  }

  clearState(conversationId: string): void {
    this.clearStateStmt.run(conversationId);
  }

  getRunningStates(): DurableAgentState[] {
    const rows = this.getRunningStmt.all() as unknown as AgentStateRow[];
    return rows.map(mapRow);
  }

  getRunningConversationIds(): string[] {
    const rows = this.getRunningIdsStmt.all() as { conversation_id: string }[];
    return rows.map(r => r.conversation_id);
  }
}

// ============================================================
// Helpers
// ============================================================

export function createFreshState(conversationId: string): DurableAgentState {
  return {
    conversationId,
    status: 'running',
    modelMessages: [],
    stepCount: 0,
    toolsUsed: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function isResumable(status: DurableAgentStatus): boolean {
  return status === 'running' || status === 'timed_out';
}
