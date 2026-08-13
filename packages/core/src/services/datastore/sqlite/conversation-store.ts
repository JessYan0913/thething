// ============================================================
// SQLite Conversation Store Implementation
// ============================================================

import type { SqliteDatabase } from '../../../primitives/datastore/types';
import type { ConversationStore, Conversation, ConversationRow } from '../../../primitives/datastore/types';

/**
 * SQLite-based ConversationStore implementation
 */
export class SQLiteConversationStore implements ConversationStore {
  constructor(private db: SqliteDatabase) {}

  createConversation(id: string, title?: string, metadata?: { source?: string; sourceId?: string; channelId?: string; projectId?: string }): Conversation {
    const stmt = this.db.prepare(
      'INSERT INTO conversations (id, title, source, source_id, channel_id, project_id) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(
      id,
      title || 'New Conversation',
      metadata?.source || 'user',
      metadata?.sourceId || null,
      metadata?.channelId || null,
      metadata?.projectId || null
    );
    return this.getConversation(id)!;
  }

  getConversation(id: string): Conversation | null {
    const stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
    const row = stmt.get(id) as ConversationRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  listConversations(): Conversation[] {
    const stmt = this.db.prepare(
      'SELECT * FROM conversations ORDER BY updated_at DESC'
    );
    const rows = stmt.all() as unknown as ConversationRow[];
    return rows.map((row) => this.mapRow(row));
  }

  updateConversationTitle(id: string, title: string): void {
    const stmt = this.db.prepare(
      'UPDATE conversations SET title = ?, updated_at = datetime(\'now\') WHERE id = ?'
    );
    stmt.run(title, id);
  }

  deleteConversation(id: string): void {
    // FK 未启用（PRAGMA foreign_keys=0），ON DELETE CASCADE 不生效，
    // 手动级联清理所有引用 conversation_id 的关联行（防孤儿残留膨胀）。
    const relatedTables = [
      'summaries',
      'memory_usage',
      'chat_costs',
      'todos',
      'pending_approvals',
      'chat_stream_events',
      'stream_chunks',
      'agent_runs',
      'agent_states',
      'suspended_agent_states',
      'messages',
      'conversation_branches',
      'conversation_branch_selections',
      'conversation_runs',
      'message_text',
    ];
    for (const table of relatedTables) {
      // 部分关联表（memory_usage/chat_stream_events/agent_states 等）由外部模块
      // 按需创建，全新库上未必存在——缺失时跳过，避免级联删除整体失败。
      try {
        this.db.prepare(`DELETE FROM ${table} WHERE conversation_id = ?`).run(id);
      } catch (e: any) {
        if (!e.message?.includes('no such table')) throw e;
      }
    }
    const stmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');
    stmt.run(id);
  }

  private mapRow(row: ConversationRow): Conversation {
    return {
      id: row.id,
      title: row.title,
      source: row.source,
      sourceId: row.source_id,
      channelId: row.channel_id,
      projectId: row.project_id,
      contextUsage: row.context_usage,
      contextTotal: row.context_total,
      contextLimit: row.context_limit,
      contextMessages: row.context_messages,
      contextInstructions: row.context_instructions,
      contextTools: row.context_tools,
      contextOutputReserve: row.context_output_reserve,
      contextCachedReadTokens: row.context_cached_read_tokens,
      contextStepInputTokens: row.context_step_input_tokens,
      contextLastCompactionFreedTokens: row.context_last_compaction_freed_tokens,
      contextCompacted: row.context_compacted ? true : null,
      // v18 新列
      contextCompactionState: row.context_compaction_state,
      contextCompactionsCount: row.context_compactions_count,
      contextTotalFreed: row.context_total_freed,
      contextSessionInput: row.context_session_input,
      contextSessionOutput: row.context_session_output,
      contextSessionCost: row.context_session_cost,
      contextCapturedAt: row.context_captured_at,
      revision: row.revision,
      activeBranchId: row.active_branch_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateContextBudget(id: string, budget: { usagePercentage: number; totalTokens: number; modelLimit: number; messagesTokens?: number; instructionsTokens?: number; toolsTokens?: number; outputReserve?: number; cachedReadTokens?: number; stepInputTokens?: number; lastCompactionFreedTokens?: number; compactionActive?: boolean; sessionInputTokens?: number; sessionOutputTokens?: number; sessionCostUsd?: number }): void {
    const stmt = this.db.prepare(
      `UPDATE conversations SET context_usage = ?, context_total = ?, context_limit = ?, context_messages = ?, context_instructions = ?, context_tools = ?, context_output_reserve = ?, context_cached_read_tokens = ?, context_step_input_tokens = ?, context_last_compaction_freed_tokens = ?, context_compacted = ?, context_session_input = ?, context_session_output = ?, context_session_cost = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(
      budget.usagePercentage,
      budget.totalTokens,
      budget.modelLimit,
      budget.messagesTokens ?? null,
      budget.instructionsTokens ?? null,
      budget.toolsTokens ?? null,
      budget.outputReserve ?? null,
      budget.cachedReadTokens ?? null,
      budget.stepInputTokens ?? null,
      budget.lastCompactionFreedTokens ?? null,
      budget.compactionActive ? 1 : null,
      budget.sessionInputTokens ?? null,
      budget.sessionOutputTokens ?? null,
      budget.sessionCostUsd ?? null,
      id,
    );
  }

  listConversationsByProject(projectId: string): Conversation[] {
    const stmt = this.db.prepare(
      'SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC'
    );
    const rows = stmt.all(projectId) as unknown as ConversationRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listConversationsWithoutProject(): Conversation[] {
    const stmt = this.db.prepare(
      'SELECT * FROM conversations WHERE project_id IS NULL ORDER BY updated_at DESC'
    );
    const rows = stmt.all() as unknown as ConversationRow[];
    return rows.map((row) => this.mapRow(row));
  }
}