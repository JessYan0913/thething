// ============================================================
// SQLite AgentRunStore Implementation
// ============================================================
// Provides durable checkpoint and stream chunk persistence
// for agent execution recovery across process restarts.

import type { SqliteDatabase, SqliteStatement } from '../../../primitives/datastore/types';
import type { AgentRun, AgentRunStore, StreamChunk } from '../../../primitives/datastore/types';

interface AgentRunRow {
  conversation_id: string;
  status: string;
  step_count: number;
  accumulated_text: string;
  tools_used: string;
  error: string | null;
  pending_approval_id: string | null;
  started_at: string;
  updated_at: string;
}

interface StreamChunkRow {
  id: number;
  conversation_id: string;
  sequence: number;
  chunk_data: string;
  created_at: string;
}

function mapRow(row: AgentRunRow): AgentRun {
  return {
    conversationId: row.conversation_id,
    status: row.status as AgentRun['status'],
    stepCount: row.step_count,
    accumulatedText: row.accumulated_text,
    toolsUsed: JSON.parse(row.tools_used),
    error: row.error,
    pendingApprovalId: row.pending_approval_id,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

function mapChunkRow(row: StreamChunkRow): StreamChunk {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    chunkData: row.chunk_data,
    createdAt: row.created_at,
  };
}

export class SQLiteAgentRunStore implements AgentRunStore {
  private insertRun: SqliteStatement;
  private updateRunStmt: SqliteStatement;
  private getRunStmt: SqliteStatement;
  private completeRunStmt: SqliteStatement;
  private failRunStmt: SqliteStatement;
  private pauseStmt: SqliteStatement;
  private resumeStmt: SqliteStatement;
  private insertChunk: SqliteStatement;
  private getChunksStmt: SqliteStatement;
  private getChunksFromStmt: SqliteStatement;
  private clearChunksStmt: SqliteStatement;

  constructor(private db: SqliteDatabase) {
    this.insertRun = db.prepare(`
      INSERT OR REPLACE INTO agent_runs (conversation_id, status, step_count, accumulated_text, tools_used, started_at, updated_at)
      VALUES (?, 'running', 0, '', '[]', datetime('now'), datetime('now'))
    `);

    this.updateRunStmt = db.prepare(`
      UPDATE agent_runs SET step_count = ?, accumulated_text = ?, tools_used = ?, updated_at = datetime('now')
      WHERE conversation_id = ?
    `);

    this.getRunStmt = db.prepare(`
      SELECT * FROM agent_runs WHERE conversation_id = ?
    `);

    this.completeRunStmt = db.prepare(`
      UPDATE agent_runs SET status = 'completed', updated_at = datetime('now')
      WHERE conversation_id = ?
    `);

    this.failRunStmt = db.prepare(`
      UPDATE agent_runs SET status = 'failed', error = ?, updated_at = datetime('now')
      WHERE conversation_id = ?
    `);

    this.pauseStmt = db.prepare(`
      UPDATE agent_runs SET status = 'paused_approval', pending_approval_id = ?, updated_at = datetime('now')
      WHERE conversation_id = ?
    `);

    this.resumeStmt = db.prepare(`
      UPDATE agent_runs SET status = 'running', pending_approval_id = NULL, updated_at = datetime('now')
      WHERE conversation_id = ?
    `);

    this.insertChunk = db.prepare(`
      INSERT INTO stream_chunks (conversation_id, sequence, chunk_data)
      VALUES (?, ?, ?)
    `);

    this.getChunksStmt = db.prepare(`
      SELECT * FROM stream_chunks WHERE conversation_id = ? ORDER BY sequence
    `);

    this.getChunksFromStmt = db.prepare(`
      SELECT * FROM stream_chunks WHERE conversation_id = ? AND sequence >= ? ORDER BY sequence
    `);

    this.clearChunksStmt = db.prepare(`
      DELETE FROM stream_chunks WHERE conversation_id = ?
    `);
  }

  createRun(conversationId: string): void {
    this.insertRun.run(conversationId);
  }

  updateRun(conversationId: string, update: {
    stepCount?: number;
    accumulatedText?: string;
    toolsUsed?: string[];
  }): void {
    const existing = this.getRun(conversationId);
    if (!existing) return;

    this.updateRunStmt.run(
      update.stepCount ?? existing.stepCount,
      update.accumulatedText ?? existing.accumulatedText,
      JSON.stringify(update.toolsUsed ?? existing.toolsUsed),
      conversationId,
    );
  }

  getRun(conversationId: string): AgentRun | null {
    const row = this.getRunStmt.get(conversationId) as AgentRunRow | undefined;
    return row ? mapRow(row) : null;
  }

  completeRun(conversationId: string): void {
    this.completeRunStmt.run(conversationId);
  }

  failRun(conversationId: string, error: string): void {
    this.failRunStmt.run(error, conversationId);
  }

  pauseForApproval(conversationId: string, approvalId: string): void {
    this.pauseStmt.run(approvalId, conversationId);
  }

  resumeFromApproval(conversationId: string): void {
    this.resumeStmt.run(conversationId);
  }

  addChunk(conversationId: string, sequence: number, data: string): void {
    this.insertChunk.run(conversationId, sequence, data);
  }

  getChunks(conversationId: string, fromSequence?: number): StreamChunk[] {
    const rows = (fromSequence !== undefined
      ? this.getChunksFromStmt.all(conversationId, fromSequence)
      : this.getChunksStmt.all(conversationId)) as unknown as StreamChunkRow[];
    return rows.map(mapChunkRow);
  }

  clearChunks(conversationId: string): void {
    this.clearChunksStmt.run(conversationId);
  }
}
