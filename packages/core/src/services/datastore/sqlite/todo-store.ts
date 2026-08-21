// ============================================================
// SQLite Todo Store — 事件化快照账本（事件落 todo_events 表）
// ============================================================
// 旧版逐行 CRUD（todos 表）已被事件日志取代（v22 迁移把现有行回填为
// 每条会话一条 backfill 快照事件后 DROP todos，见 schema.ts）：
//   append  = INSERT INTO todo_events（全量快照 payload）
//   rebuild = 取每会话最后一条快照事件 → SnapshotTodoStore 内存重建
// 写出路径与 InMemory 版完全一致（同一个 SnapshotTodoStore），
// 唯一区别是事件落 SQLite 而非内存数组。

import type { SqliteDatabase } from '../../../primitives/datastore/types';
import type { TodoEventSink, TodoSnapshotEvent } from '../todo-event-store';
import { SnapshotTodoStore } from '../todo-event-store';

/** todo_events 行 → 事件（供给 SnapshotTodoStore 启动重建）。 */
interface TodoEventRow {
  seq: number;
  conversation_id: string;
  reason: string;
  payload: string;
  created_at: string;
  run_id: string | null;
}

class SqliteTodoEventSink implements TodoEventSink {
  constructor(private db: SqliteDatabase) {}

  append(event: Omit<TodoSnapshotEvent, 'seq'>): void {
    this.db
      .prepare(
        `INSERT INTO todo_events (conversation_id, event_type, reason, payload, run_id, branch_id, created_at)
         VALUES (?, 'snapshot', ?, ?, ?, 'main', ?)`,
      )
      .run(
        event.conversationId,
        event.reason,
        event.payload,
        event.runId ?? null,
        new Date(event.createdAt).toISOString(),
      );
  }

  loadAll(): TodoSnapshotEvent[] {
    const rows = this.db
      .prepare(
        `SELECT seq, conversation_id, reason, payload, created_at, run_id
         FROM todo_events ORDER BY seq ASC`,
      )
      .all() as unknown as TodoEventRow[];
    return rows.map((r) => ({
      seq: r.seq,
      conversationId: r.conversation_id,
      reason: r.reason as TodoSnapshotEvent['reason'],
      payload: r.payload,
      createdAt: new Date(r.created_at).getTime(),
      runId: r.run_id,
    }));
  }
}

/**
 * SQLite 版 SnapshotTodoStore：事件落 todo_events，启动时重建内存快照。
 * 复用统一实现（docs/todos-lite.md §5.5）——两个 store 收敛为同一个。
 */
export class SQLiteTodoStore extends SnapshotTodoStore {
  constructor(db: SqliteDatabase) {
    super(new SqliteTodoEventSink(db));
  }
}