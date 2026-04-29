// ============================================================
// SQLite Task Store Implementation
// ============================================================
// Persistent task storage using SQLite database.
// Implements the TaskStore interface from runtime/tasks/types.ts.

import { nanoid } from 'nanoid';
import type { SqliteDatabase } from '../types';
import type { TaskRow } from '../types';
import type {
  Task,
  TaskStore,
  TaskCreateInput,
  TaskUpdateInput,
  TaskClaimResult,
  TaskStatus,
  AgentStatus,
  TaskEventListener,
  TaskEvent,
  TaskEventType,
} from '../../../runtime/tasks/types';

/**
 * SQLite-based TaskStore implementation
 */
export class SQLiteTaskStore implements TaskStore {
  private db: SqliteDatabase;
  private listeners: Set<TaskEventListener> = new Set();
  private agentStatus: Map<string, AgentStatus> = new Map();

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  // ============================================================
  // Helper: Parse task row to Task object
  // ============================================================
  private parseRow(row: TaskRow): Task {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      subject: row.subject,
      status: row.status as TaskStatus,
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
  private emit(type: TaskEventType, task: Task, metadata?: Record<string, unknown>): void {
    const event: TaskEvent = {
      type,
      task,
      timestamp: Date.now(),
      metadata,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[SQLiteTaskStore] Event listener error:', e);
      }
    }
  }

  // ============================================================
  // Helper: Update blocks reverse index
  // ============================================================
  private updateBlocksIndex(taskId: string, blockedBy: string[]): void {
    // Get current blocks list
    const currentTask = this.getTask(taskId);
    if (!currentTask) return;

    const oldBlockedBy = currentTask.blockedBy;
    const newBlockedBy = blockedBy;

    // Remove from old blockers' blocks list
    for (const oldDep of oldBlockedBy) {
      const blocker = this.getTask(oldDep);
      if (blocker) {
        const newBlocks = blocker.blocks.filter(id => id !== taskId);
        this.db.prepare(`UPDATE tasks SET blocks = ? WHERE id = ?`).run(JSON.stringify(newBlocks), oldDep);
      }
    }

    // Add to new blockers' blocks list
    for (const newDep of newBlockedBy) {
      const blocker = this.getTask(newDep);
      if (blocker) {
        const newBlocks = [...blocker.blocks, taskId];
        this.db.prepare(`UPDATE tasks SET blocks = ? WHERE id = ?`).run(JSON.stringify(newBlocks), newDep);
      }
    }
  }

  // ============================================================
  // Helper: Check if all dependencies are completed
  // ============================================================
  private areDependenciesCompleted(blockedBy: string[]): boolean {
    if (blockedBy.length === 0) return true;
    for (const depId of blockedBy) {
      const dep = this.getTask(depId);
      if (!dep || dep.status !== 'completed') return false;
    }
    return true;
  }

  // ============================================================
  // Helper: Unblock dependent tasks when this task completes
  // ============================================================
  private unblockDependents(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task) return;

    // Notify listeners that dependent tasks may now be available
    for (const depId of task.blocks) {
      const dep = this.getTask(depId);
      if (dep && dep.status === 'pending' && this.areDependenciesCompleted(dep.blockedBy)) {
        this.emit('task:updated', dep, { reason: 'dependency_completed', completedTaskId: taskId });
      }
    }
  }

  // ============================================================
  // TaskStore Implementation
  // ============================================================

  createTask(input: TaskCreateInput): Task {
    const id = `task-${nanoid(8)}`;
    const now = new Date().toISOString();
    const blockedBy = input.blockedBy ?? [];

    // Validate dependencies exist and belong to same conversation
    for (const depId of blockedBy) {
      const dep = this.getTask(depId);
      if (!dep) {
        throw new Error(`[SQLiteTaskStore] Dependency ${depId} does not exist`);
      }
      if (dep.conversationId !== input.conversationId) {
        throw new Error(`[SQLiteTaskStore] Dependency ${depId} belongs to different conversation`);
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, conversation_id, subject, status, blocked_by, created_at, updated_at, metadata)
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
      const blocker = this.getTask(depId);
      if (blocker) {
        const newBlocks = [...blocker.blocks, id];
        this.db.prepare(`UPDATE tasks SET blocks = ? WHERE id = ?`).run(JSON.stringify(newBlocks), depId);
      }
    }

    const task = this.getTask(id)!;
    this.emit('task:created', task);
    return task;
  }

  getTask(id: string): Task | undefined {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`);
    const row = stmt.get(id) as TaskRow | undefined;
    return row ? this.parseRow(row) : undefined;
  }

  getAllTasks(): Task[] {
    const stmt = this.db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`);
    const rows = stmt.all() as unknown as TaskRow[];
    return rows.map(row => this.parseRow(row));
  }

  getTasksByConversation(conversationId: string): Task[] {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE conversation_id = ? ORDER BY created_at DESC`);
    const rows = stmt.all(conversationId) as unknown as TaskRow[];
    return rows.map(row => this.parseRow(row));
  }

  updateTask(input: TaskUpdateInput): Task | undefined {
    const existing = this.getTask(input.id);
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

    const stmt = this.db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    const updated = this.getTask(input.id)!;
    this.emit('task:updated', updated);
    return updated;
  }

  deleteTask(id: string): boolean {
    const existing = this.getTask(id);
    if (!existing) return false;

    // Clean up blocks reverse index
    this.updateBlocksIndex(id, []);

    // Free the agent if claimed
    if (existing.claimedBy) {
      this.setAgentBusy(existing.claimedBy, false);
    }

    const stmt = this.db.prepare(`DELETE FROM tasks WHERE id = ?`);
    stmt.run(id);

    this.emit('task:deleted', existing);
    return true;
  }

  claimTask(taskId: string, agentId: string): TaskClaimResult {
    // Check if agent is busy
    const agentStatus = this.getAgentStatus(agentId);
    if (agentStatus.isBusy) {
      return {
        success: false,
        message: `Agent ${agentId} is already busy with task ${agentStatus.currentTaskId}`,
      };
    }

    const task = this.getTask(taskId);
    if (!task) {
      return { success: false, message: `Task ${taskId} not found` };
    }

    // Check task status
    if (task.status !== 'pending') {
      return { success: false, message: `Task ${taskId} is not pending (status: ${task.status})` };
    }

    // Check dependencies
    if (!this.areDependenciesCompleted(task.blockedBy)) {
      const pendingDeps = task.blockedBy.filter(depId => {
        const dep = this.getTask(depId);
        return !dep || dep.status !== 'completed';
      });
      return {
        success: false,
        message: `Task ${taskId} has incomplete dependencies: ${pendingDeps.join(', ')}`,
      };
    }

    // Check if already claimed
    if (task.claimedBy) {
      return { success: false, message: `Task ${taskId} is already claimed by ${task.claimedBy}` };
    }

    // Claim the task
    this.db.prepare(`
      UPDATE tasks SET status = 'in_progress', claimed_by = ?, updated_at = ?
      WHERE id = ?
    `).run(agentId, new Date().toISOString(), taskId);

    this.setAgentBusy(agentId, true, taskId);

    const claimed = this.getTask(taskId)!;
    this.emit('task:claimed', claimed, { agentId });
    return { success: true, task: claimed };
  }

  getAvailableTasks(): Task[] {
    // Get all pending tasks
    const pending = this.getTasksByStatus('pending');

    // Filter by dependency completion and not claimed
    return pending.filter(task => {
      if (task.claimedBy) return false;
      return this.areDependenciesCompleted(task.blockedBy);
    });
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC`);
    const rows = stmt.all(status) as unknown as TaskRow[];
    return rows.map(row => this.parseRow(row));
  }

  getTasksByAgent(agentId: string): Task[] {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE claimed_by = ? ORDER BY updated_at DESC`);
    const rows = stmt.all(agentId) as unknown as TaskRow[];
    return rows.map(row => this.parseRow(row));
  }

  getBlockingTasks(taskId: string): Task[] {
    const task = this.getTask(taskId);
    if (!task) return [];
    return task.blocks.map(id => this.getTask(id)!).filter(Boolean);
  }

  getBlockedByTasks(taskId: string): Task[] {
    const task = this.getTask(taskId);
    if (!task) return [];
    return task.blockedBy.map(id => this.getTask(id)!).filter(Boolean);
  }

  subscribe(listener: TaskEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAgentStatus(agentId: string): AgentStatus {
    return this.agentStatus.get(agentId) ?? {
      agentId,
      isBusy: false,
      currentTaskId: null,
    };
  }

  setAgentBusy(agentId: string, busy: boolean, taskId?: string): void {
    this.agentStatus.set(agentId, {
      agentId,
      isBusy: busy,
      currentTaskId: busy ? taskId ?? null : null,
    });
  }

  clearAllTasks(): void {
    this.db.prepare(`DELETE FROM tasks`).run();
    this.agentStatus.clear();
    console.log('[SQLiteTaskStore] All tasks cleared');
  }
}