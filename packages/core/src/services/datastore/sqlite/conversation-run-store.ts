import type {
  ConversationRun,
  ConversationRunStore,
  SqliteDatabase,
} from '../../../primitives/datastore/types';

interface ConversationRunRow {
  id: string;
  conversation_id: string;
  branch_id: string | null;
  anchor_message_id: string | null;
  expected_tip_id: string | null;
  result_tip_id: string | null;
  model: string | null;
  agent_type: string | null;
  status: ConversationRun['status'];
  error: string | null;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

function mapRow(row: ConversationRunRow): ConversationRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    branchId: row.branch_id,
    anchorMessageId: row.anchor_message_id,
    expectedTipId: row.expected_tip_id,
    resultTipId: row.result_tip_id,
    model: row.model,
    agentType: row.agent_type,
    status: row.status,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export class SQLiteConversationRunStore implements ConversationRunStore {
  constructor(private db: SqliteDatabase) {}

  createRun(input: {
    id: string;
    conversationId: string;
    branchId?: string | null;
    anchorMessageId?: string | null;
    expectedTipId?: string | null;
    model?: string | null;
    agentType?: string | null;
  }): ConversationRun {
    this.db.prepare(
      `INSERT INTO conversation_runs
         (id, conversation_id, branch_id, anchor_message_id, expected_tip_id, model, agent_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.conversationId,
      input.branchId ?? null,
      input.anchorMessageId ?? null,
      input.expectedTipId ?? null,
      input.model ?? null,
      input.agentType ?? null,
    );
    return this.getRun(input.id)!;
  }

  finishRun(runId: string, input: {
    status: Exclude<ConversationRun['status'], 'running'>;
    resultTipId?: string | null;
    error?: string | null;
  }): void {
    this.db.prepare(
      `UPDATE conversation_runs
          SET status = ?, result_tip_id = ?, error = ?,
              finished_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`
    ).run(input.status, input.resultTipId ?? null, input.error ?? null, runId);
  }

  getRun(runId: string): ConversationRun | null {
    const row = this.db.prepare('SELECT * FROM conversation_runs WHERE id = ?')
      .get(runId) as ConversationRunRow | undefined;
    return row ? mapRow(row) : null;
  }

  listRuns(conversationId: string, branchId?: string): ConversationRun[] {
    const rows = (branchId
      ? this.db.prepare(
          'SELECT * FROM conversation_runs WHERE conversation_id = ? AND branch_id = ? ORDER BY started_at DESC'
        ).all(conversationId, branchId)
      : this.db.prepare(
          'SELECT * FROM conversation_runs WHERE conversation_id = ? ORDER BY started_at DESC'
        ).all(conversationId)) as unknown as ConversationRunRow[];
    return rows.map(mapRow);
  }
}
