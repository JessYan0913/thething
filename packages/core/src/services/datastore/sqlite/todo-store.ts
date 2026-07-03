// ============================================================
// SQLite Todo Store Implementation
// ============================================================
// Persistent todo storage using SQLite database.
// Implements the TodoStore interface from runtime/todos/types.ts.

import { nanoid } from 'nanoid';
import type { SqliteDatabase } from '../../../primitives/datastore/types';
import type { TodoRow } from '../../../primitives/datastore/types';
import { logger } from '../../../primitives/logger';
import type {
  Todo,
  TodoStore,
  TodoCreateInput,
  TodoUpdateInput,
  TodoClaimResult,
  TodoStatus,
  AgentStatus,
  TodoEvent,
  TodoEventListener,
  TodoEventType,
} from '../../../primitives/datastore/types';

/**
 * SQLite-based TodoStore implementation
 */
export class SQLiteTodoStore implements TodoStore {
  private db: SqliteDatabase;
  private listeners: Set<TodoEventListener> = new Set();
  private agentStatus: Map<string, AgentStatus> = new Map();

  // Agent status persistence statements (lazy init)
  private _upsertAgentStatusStmt: ReturnType<SqliteDatabase['prepare']> | null = null;
  private _getAgentStatusStmt: ReturnType<SqliteDatabase['prepare']> | null = null;
  private _clearAgentStatusStmt: ReturnType<SqliteDatabase['prepare']> | null = null;
  private _agentStatusTableExists: boolean | null = null;

  constructor(db: SqliteDatabase) {
    this.db = db;

    // 启动时恢复 agent 状态（如果表存在）
    if (this.agentStatusTableReady()) {
      this.recoverAgentStatus();
    }
  }

  /**
   * 检查 agent_status 表是否存在，结果缓存
   */
  private agentStatusTableReady(): boolean {
    if (this._agentStatusTableExists !== null) return this._agentStatusTableExists;
    try {
      const row = this.db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='agent_status'`
      ).get() as { name: string } | undefined;
      this._agentStatusTableExists = !!row;
    } catch {
      this._agentStatusTableExists = false;
    }
    return this._agentStatusTableExists;
  }

  private get upsertAgentStatusStmt() {
    if (!this._upsertAgentStatusStmt) {
      this._upsertAgentStatusStmt = this.db.prepare(`
        INSERT INTO agent_status (agent_id, is_busy, current_todo_id, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(agent_id) DO UPDATE SET
          is_busy = excluded.is_busy,
          current_todo_id = excluded.current_todo_id,
          updated_at = excluded.updated_at
      `);
    }
    return this._upsertAgentStatusStmt;
  }

  private get getAgentStatusStmt() {
    if (!this._getAgentStatusStmt) {
      this._getAgentStatusStmt = this.db.prepare(`
        SELECT * FROM agent_status WHERE agent_id = ?
      `);
    }
    return this._getAgentStatusStmt;
  }

  private get clearAgentStatusStmt() {
    if (!this._clearAgentStatusStmt) {
      this._clearAgentStatusStmt = this.db.prepare(`
        DELETE FROM agent_status
      `);
    }
    return this._clearAgentStatusStmt;
  }

  // ============================================================
  // Helper: Parse todo row to Todo object
  // ============================================================
  private parseRow(row: TodoRow): Todo {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      subject: row.subject,
      status: row.status as TodoStatus,
      claimedBy: row.claimed_by,
      activeForm: row.active_form,
      blockedBy: JSON.parse(row.blocked_by || '[]'),
      blocks: JSON.parse(row.blocks || '[]'),
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }

  // ============================================================
  // Helper: Emit event to listeners
  // ============================================================
  private emit(type: TodoEventType, todo: Todo, metadata?: Record<string, unknown>): void {
    const event: TodoEvent = {
      type,
      todo,
      timestamp: Date.now(),
      metadata,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        logger.error('SQLiteTodoStore', 'Event listener error:', e);
      }
    }
  }

  // ============================================================
  // Helper: Update blocks reverse index
  // ============================================================
  private updateBlocksIndex(todoId: string, blockedBy: string[]): void {
    // Get current blocks list
    const currentTodo = this.getTodo(todoId);
    if (!currentTodo) return;

    const oldBlockedBy = currentTodo.blockedBy;
    const newBlockedBy = blockedBy;

    // Remove from old blockers' blocks list
    for (const oldDep of oldBlockedBy) {
      const blocker = this.getTodo(oldDep);
      if (blocker) {
        const newBlocks = blocker.blocks.filter(id => id !== todoId);
        this.db.prepare(`UPDATE todos SET blocks = ? WHERE id = ?`).run(JSON.stringify(newBlocks), oldDep);
      }
    }

    // Add to new blockers' blocks list
    for (const newDep of newBlockedBy) {
      const blocker = this.getTodo(newDep);
      if (blocker) {
        const newBlocks = [...blocker.blocks, todoId];
        this.db.prepare(`UPDATE todos SET blocks = ? WHERE id = ?`).run(JSON.stringify(newBlocks), newDep);
      }
    }
  }

  // ============================================================
  // Helper: Check if all dependencies are completed
  // ============================================================
  private areDependenciesCompleted(blockedBy: string[]): boolean {
    if (blockedBy.length === 0) return true;
    for (const depId of blockedBy) {
      const dep = this.getTodo(depId);
      if (!dep || dep.status !== 'completed') return false;
    }
    return true;
  }

  // ============================================================
  // Helper: Unblock dependent todos when this todo completes
  // ============================================================
  private unblockDependents(todoId: string): void {
    const todo = this.getTodo(todoId);
    if (!todo) return;

    // Notify listeners that dependent todos may now be available
    for (const depId of todo.blocks) {
      const dep = this.getTodo(depId);
      if (dep && dep.status === 'pending' && this.areDependenciesCompleted(dep.blockedBy)) {
        this.emit('todo:updated', dep, { reason: 'dependency_completed', completedTodoId: todoId });
      }
    }
  }

  // ============================================================
  // TodoStore Implementation
  // ============================================================

  createTodo(input: TodoCreateInput): Todo {
    const id = `todo-${nanoid(8)}`;
    const now = new Date().toISOString();
    const blockedBy = input.blockedBy ?? [];

    // Validate dependencies exist and belong to same conversation
    for (const depId of blockedBy) {
      const dep = this.getTodo(depId);
      if (!dep) {
        throw new Error(`[SQLiteTodoStore] Dependency ${depId} does not exist`);
      }
      if (dep.conversationId !== input.conversationId) {
        throw new Error(`[SQLiteTodoStore] Dependency ${depId} belongs to different conversation`);
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO todos (id, conversation_id, subject, status, blocked_by, created_at, updated_at, metadata)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.conversationId,
      input.subject,
      JSON.stringify(blockedBy),
      now,
      now,
      JSON.stringify(input.metadata ?? {})
    );

    // Update blockers' blocks reverse index
    for (const depId of blockedBy) {
      const blocker = this.getTodo(depId);
      if (blocker) {
        const newBlocks = [...blocker.blocks, id];
        this.db.prepare(`UPDATE todos SET blocks = ? WHERE id = ?`).run(JSON.stringify(newBlocks), depId);
      }
    }

    const todo = this.getTodo(id)!;
    this.emit('todo:created', todo);
    return todo;
  }

  getTodo(id: string): Todo | undefined {
    const stmt = this.db.prepare(`SELECT * FROM todos WHERE id = ?`);
    const row = stmt.get(id) as TodoRow | undefined;
    return row ? this.parseRow(row) : undefined;
  }

  getAllTodos(): Todo[] {
    const stmt = this.db.prepare(`SELECT * FROM todos ORDER BY created_at DESC`);
    const rows = stmt.all() as unknown as TodoRow[];
    return rows.map(row => this.parseRow(row));
  }

  getTodosByConversation(conversationId: string): Todo[] {
    const stmt = this.db.prepare(`SELECT * FROM todos WHERE conversation_id = ? ORDER BY created_at DESC`);
    const rows = stmt.all(conversationId) as unknown as TodoRow[];
    return rows.map(row => this.parseRow(row));
  }

  updateTodo(input: TodoUpdateInput): Todo | undefined {
    const existing = this.getTodo(input.id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: unknown[] = [];

    // Handle status change
    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);

      // Handle completion status
      if (['completed', 'failed', 'cancelled'].includes(input.status)) {
        updates.push('completed_at = ?');
        values.push(now);
        updates.push('claimed_by = NULL');
        updates.push('active_form = NULL');

        // Free the agent
        if (existing.claimedBy) {
          this.setAgentBusy(existing.claimedBy, false);
        }

        // Unblock dependents if completed
        if (input.status === 'completed') {
          this.unblockDependents(input.id);
        }
      }
    }

    // Handle other fields
    if (input.subject !== undefined) {
      updates.push('subject = ?');
      values.push(input.subject);
    }

    if (input.activeForm !== undefined) {
      updates.push('active_form = ?');
      values.push(input.activeForm);
    }

    if (input.claimedBy !== undefined) {
      updates.push('claimed_by = ?');
      values.push(input.claimedBy);
    }

    // Handle blockedBy change
    if (input.blockedBy !== undefined) {
      updates.push('blocked_by = ?');
      values.push(JSON.stringify(input.blockedBy));
      this.updateBlocksIndex(input.id, input.blockedBy);
    }

    // Handle metadata merge
    if (input.metadata !== undefined) {
      const mergedMetadata = { ...existing.metadata, ...input.metadata };
      updates.push('metadata = ?');
      values.push(JSON.stringify(mergedMetadata));
    }

    // Always update updated_at
    updates.push('updated_at = ?');
    values.push(now);

    // Add WHERE clause value
    values.push(input.id);

    const stmt = this.db.prepare(`UPDATE todos SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    const updated = this.getTodo(input.id)!;
    this.emit('todo:updated', updated);
    return updated;
  }

  deleteTodo(id: string): boolean {
    const existing = this.getTodo(id);
    if (!existing) return false;

    // Clean up blocks reverse index
    this.updateBlocksIndex(id, []);

    // Free the agent if claimed
    if (existing.claimedBy) {
      this.setAgentBusy(existing.claimedBy, false);
    }

    const stmt = this.db.prepare(`DELETE FROM todos WHERE id = ?`);
    stmt.run(id);

    this.emit('todo:deleted', existing);
    return true;
  }

  claimTodo(todoId: string, agentId: string): TodoClaimResult {
    // Check if agent is busy
    const agentStatus = this.getAgentStatus(agentId);
    if (agentStatus.isBusy) {
      return {
        success: false,
        message: `Agent ${agentId} is already busy with todo ${agentStatus.currentTodoId}`,
      };
    }

    const todo = this.getTodo(todoId);
    if (!todo) {
      return { success: false, message: `Todo ${todoId} not found` };
    }

    // Check todo status
    if (todo.status !== 'pending') {
      return { success: false, message: `Todo ${todoId} is not pending (status: ${todo.status})` };
    }

    // Check dependencies
    if (!this.areDependenciesCompleted(todo.blockedBy)) {
      const pendingDeps = todo.blockedBy.filter(depId => {
        const dep = this.getTodo(depId);
        return !dep || dep.status !== 'completed';
      });
      return {
        success: false,
        message: `Todo ${todoId} has incomplete dependencies: ${pendingDeps.join(', ')}`,
      };
    }

    // Check if already claimed
    if (todo.claimedBy) {
      return { success: false, message: `Todo ${todoId} is already claimed by ${todo.claimedBy}` };
    }

    // Claim the todo
    this.db.prepare(`
      UPDATE todos SET status = 'in_progress', claimed_by = ?, updated_at = ?
      WHERE id = ?
    `).run(agentId, new Date().toISOString(), todoId);

    this.setAgentBusy(agentId, true, todoId);

    const claimed = this.getTodo(todoId)!;
    this.emit('todo:claimed', claimed, { agentId });
    return { success: true, todo: claimed };
  }

  getAvailableTodos(): Todo[] {
    // Get all pending todos
    const pending = this.getTodosByStatus('pending');

    // Filter by dependency completion and not claimed
    return pending.filter(todo => {
      if (todo.claimedBy) return false;
      return this.areDependenciesCompleted(todo.blockedBy);
    });
  }

  getTodosByStatus(status: TodoStatus): Todo[] {
    const stmt = this.db.prepare(`SELECT * FROM todos WHERE status = ? ORDER BY created_at DESC`);
    const rows = stmt.all(status) as unknown as TodoRow[];
    return rows.map(row => this.parseRow(row));
  }

  getTodosByAgent(agentId: string): Todo[] {
    const stmt = this.db.prepare(`SELECT * FROM todos WHERE claimed_by = ? ORDER BY updated_at DESC`);
    const rows = stmt.all(agentId) as unknown as TodoRow[];
    return rows.map(row => this.parseRow(row));
  }

  getBlockingTodos(todoId: string): Todo[] {
    const todo = this.getTodo(todoId);
    if (!todo) return [];
    return todo.blocks.map(id => this.getTodo(id)!).filter(Boolean);
  }

  getBlockedByTodos(todoId: string): Todo[] {
    const todo = this.getTodo(todoId);
    if (!todo) return [];
    return todo.blockedBy.map(id => this.getTodo(id)!).filter(Boolean);
  }

  subscribe(listener: TodoEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAgentStatus(agentId: string): AgentStatus {
    // 先检查内存缓存
    const cached = this.agentStatus.get(agentId);
    if (cached) return cached;

    // 从 SQLite 读取（如果表存在）
    if (!this.agentStatusTableReady()) {
      return { agentId, isBusy: false, currentTodoId: null };
    }
    const row = this.getAgentStatusStmt.get(agentId) as { agent_id: string; is_busy: number; current_todo_id: string | null } | undefined;
    if (row) {
      const status: AgentStatus = {
        agentId: row.agent_id,
        isBusy: row.is_busy === 1,
        currentTodoId: row.current_todo_id,
      };
      this.agentStatus.set(agentId, status);
      return status;
    }

    return {
      agentId,
      isBusy: false,
      currentTodoId: null,
    };
  }

  setAgentBusy(agentId: string, busy: boolean, todoId?: string): void {
    const status: AgentStatus = {
      agentId,
      isBusy: busy,
      currentTodoId: busy ? todoId ?? null : null,
    };
    this.agentStatus.set(agentId, status);

    // 持久化到 SQLite（如果表存在）
    if (this.agentStatusTableReady()) {
      this.upsertAgentStatusStmt.run(agentId, busy ? 1 : 0, status.currentTodoId);
    }
  }

  clearAllTodos(): void {
    this.db.prepare(`DELETE FROM todos`).run();
    this.agentStatus.clear();
    if (this.agentStatusTableReady()) {
      this.clearAgentStatusStmt.run();
    }
    logger.debug('SQLiteTodoStore', 'All todos cleared');
  }

  /**
   * 启动时恢复 agent 状态。
   * 清理无效的 busy 状态（对应的 todo 不存在或已完成）。
   */
  private recoverAgentStatus(): void {
    try {
      const rows = this.db.prepare(`SELECT * FROM agent_status WHERE is_busy = 1`).all() as Array<{
        agent_id: string;
        current_todo_id: string | null;
      }>;

      for (const row of rows) {
        // 验证对应的 todo 是否仍然有效
        if (row.current_todo_id) {
          const todo = this.db.prepare(
            `SELECT status FROM todos WHERE id = ?`
          ).get(row.current_todo_id) as { status: string } | undefined;

          if (!todo || todo.status !== 'in_progress') {
            // todo 不存在或已完成/失败，清除 busy 状态
            this.db.prepare(
              `UPDATE agent_status SET is_busy = 0, current_todo_id = NULL, updated_at = datetime('now') WHERE agent_id = ?`
            ).run(row.agent_id);
            logger.debug('SQLiteTodoStore', `Recovered agent ${row.agent_id}: cleared stale busy state (todo ${row.current_todo_id} is ${todo?.status ?? 'missing'})`);
            continue;
          }
        }

        // 有效的 busy 状态，恢复到内存缓存
        this.agentStatus.set(row.agent_id, {
          agentId: row.agent_id,
          isBusy: true,
          currentTodoId: row.current_todo_id,
        });
        logger.debug('SQLiteTodoStore', `Recovered agent ${row.agent_id}: busy with todo ${row.current_todo_id}`);
      }
    } catch (err) {
      logger.warn('SQLiteTodoStore', 'Failed to recover agent status:', err);
    }
  }
}