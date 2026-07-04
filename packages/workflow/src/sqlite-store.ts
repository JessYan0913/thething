// ============================================================
// SQLite AgentStateStore Implementation
// ============================================================
// Provides durable state persistence for the workflow orchestrator.
// Stores DurableAgentState as JSON in SQLite.

import type { DurableAgentState, DurableAgentStatus, AgentStateStore } from '@the-thing/workflow-harness';

/** Minimal SQLite interface — compatible with better-sqlite3 and SqliteDatabase */
interface SqliteLike {
  prepare(sql: string): SqliteStatementLike;
}

interface SqliteStatementLike {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown;
}

interface AgentStateRow {
  conversation_id: string;
  status: string;
  accumulated_messages: string;
  stream_context: string;
  pending_messages: string | null;
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
    accumulatedMessages: JSON.parse(row.accumulated_messages),
    streamContext: row.stream_context ? JSON.parse(row.stream_context) : undefined,
    pendingMessages: row.pending_messages ? JSON.parse(row.pending_messages) : undefined,
    stepCount: row.step_count,
    toolsUsed: JSON.parse(row.tools_used),
    error: row.error ?? undefined,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

export class SQLiteAgentStateStore implements AgentStateStore {
  private getStateStmt: SqliteStatementLike;
  private insertStateStmt: SqliteStatementLike;
  private updateStateStmt: SqliteStatementLike;
  private updateStatusStmt: SqliteStatementLike;
  private clearStateStmt: SqliteStatementLike;
  private getRunningStmt: SqliteStatementLike;

  constructor(private db: SqliteLike) {
    this.getStateStmt = db.prepare(`
      SELECT * FROM agent_states WHERE conversation_id = ?
    `);

    this.insertStateStmt = db.prepare(`
      INSERT OR REPLACE INTO agent_states
        (conversation_id, status, accumulated_messages, stream_context, pending_messages,
         step_count, tools_used, error, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateStateStmt = db.prepare(`
      UPDATE agent_states
      SET status = ?, accumulated_messages = ?, stream_context = ?, pending_messages = ?,
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
        JSON.stringify(state.accumulatedMessages),
        state.streamContext ? JSON.stringify(state.streamContext) : null,
        state.pendingMessages ? JSON.stringify(state.pendingMessages) : null,
        state.stepCount,
        JSON.stringify(state.toolsUsed),
        state.error ?? null,
        state.conversationId,
      );
    } else {
      this.insertStateStmt.run(
        state.conversationId,
        state.status,
        JSON.stringify(state.accumulatedMessages),
        state.streamContext ? JSON.stringify(state.streamContext) : null,
        state.pendingMessages ? JSON.stringify(state.pendingMessages) : null,
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
    const rows = this.getRunningStmt.all() as AgentStateRow[];
    return rows.map(mapRow);
  }
}
