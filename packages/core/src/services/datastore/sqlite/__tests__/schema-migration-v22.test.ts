import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSQLiteDataStore } from '../sqlite-data-store';
import { getDatabase } from '../native-loader';

type TodoRow = {
  id: string;
  conversation_id: string;
  subject: string;
  status: string;
  created_at: string;
};

/**
 * 把 v22 库改装回 v21 形态：删 todo_events，手工建旧 todos 表 + 三索引 + 存量行，
 * 置 user_version=21。重开后只触发 v22 回填迁移。
 */
function patchToV21(dbPath: string, rows: TodoRow[], extraOrphanRows: TodoRow[]): void {
  const Database = getDatabase();
  const db = new Database(dbPath) as unknown as {
    exec(sql: string): void;
    pragma(pragma: string): unknown;
    close(): void;
  };
  db.exec(`
    DROP TABLE IF EXISTS todo_events;
    DROP INDEX IF EXISTS idx_todo_events_conversation;
    CREATE TABLE todos (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      claimed_by TEXT,
      active_form TEXT,
      blocked_by TEXT NOT NULL DEFAULT '[]',
      blocks TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_todos_conversation ON todos(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
    CREATE INDEX IF NOT EXISTS idx_todos_claimed ON todos(claimed_by);
  `);
  for (const r of [...rows, ...extraOrphanRows]) {
    db.exec(
      `INSERT INTO todos (id, conversation_id, subject, status, created_at, updated_at)
       VALUES ('${r.id}', '${r.conversation_id}', '${r.subject}', '${r.status}', '${r.created_at}', '${r.created_at}')`,
    );
  }
  db.pragma('user_version = 21');
  db.close();
}

describe('Schema v22 migration (todos → todo_events 快照事件账本)', () => {
  let tmpDir: string;
  let store: ReturnType<typeof createSQLiteDataStore>;

  afterEach(() => {
    store?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('回填：每会话一条 backfill 事件、按创建序赋 1..n；无主孤儿行不参与但留备份', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-v22-migration-'));
    const dbPath = path.join(tmpDir, 'chat.db');

    // 建 v22 schema + 两个有效会话
    const seed = createSQLiteDataStore({ dataDir: tmpDir });
    seed.conversationStore.createConversation('c1');
    seed.conversationStore.createConversation('c2');
    seed.close();

    // 改装回 v21：c1 两条（乱序时间戳测排序）、c2 一条、孤儿 conv-orphan 一条
    patchToV21(dbPath, [
      { id: 't-b', conversation_id: 'c1', subject: 'second', status: 'pending', created_at: '2026-08-01 10:00:00' },
      { id: 't-a', conversation_id: 'c1', subject: 'first', status: 'completed', created_at: '2026-08-01 09:00:00' },
      { id: 't-c', conversation_id: 'c2', subject: 'solo', status: 'in_progress', created_at: '2026-08-02 09:00:00' },
    ], [
      { id: 't-o', conversation_id: 'orphan-conv', subject: 'no owner', status: 'pending', created_at: '2026-08-03 09:00:00' },
    ]);

    store = createSQLiteDataStore({ dataDir: tmpDir });

    // user_version 提升到 22
    const Database = getDatabase();
    const db = new Database(dbPath, { readonly: true }) as unknown as {
      pragma(pragma: string): unknown;
      prepare(sql: string): { all(): Array<Record<string, unknown>>; get(): Record<string, unknown> };
      close(): void;
    };
    expect((db.pragma('user_version') as Array<{ user_version: number }>)[0].user_version).toBe(22);

    // 事件只含有效会话：c1 一条 + c2 一条 = 2，无孤儿
    const events = db.prepare('SELECT conversation_id, reason FROM todo_events ORDER BY seq ASC').all();
    expect(events).toEqual([
      { conversation_id: 'c1', reason: 'backfill' },
      { conversation_id: 'c2', reason: 'backfill' },
    ]);
    db.close();

    // c1 编号按创建序物化：first=#1、second=#2（时间戳乱序仍对）
    const c1 = store.todoStore.getTodosByConversation('c1');
    expect(c1.map(t => t.subject)).toEqual(['first', 'second']);
    expect(c1.map(t => t.number)).toEqual([1, 2]);
    expect(c1[0].status).toBe('completed');
    expect(store.todoStore.getTodosByConversation('c2').map(t => t.number)).toEqual([1]);

    // 孤儿行不参与回填
    expect(store.todoStore.getTodosByConversation('orphan-conv')).toEqual([]);

    // 数据安全：旧表留备份 todos_legacy（含孤儿行在内全量）
    const db2 = new Database(dbPath, { readonly: true }) as unknown as {
      prepare(sql: string): { all(): Array<Record<string, unknown>> };
      close(): void;
    };
    const legacy = db2.prepare('SELECT id, conversation_id FROM todos_legacy ORDER BY id').all();
    expect(legacy).toEqual([
      { id: 't-a', conversation_id: 'c1' },
      { id: 't-b', conversation_id: 'c1' },
      { id: 't-c', conversation_id: 'c2' },
      { id: 't-o', conversation_id: 'orphan-conv' },
    ]);
    db2.close();
  });

  it('空 todos 表直接 DROP，无备份残留', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-v22-empty-'));
    const dbPath = path.join(tmpDir, 'chat.db');

    const seed = createSQLiteDataStore({ dataDir: tmpDir });
    seed.close();

    patchToV21(dbPath, [], []);

    store = createSQLiteDataStore({ dataDir: tmpDir });

    const Database = getDatabase();
    const db = new Database(dbPath, { readonly: true }) as unknown as {
      prepare(sql: string): { get(): { n: number } };
      close(): void;
    };
    const todos = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='todos'").get().n;
    const legacy = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='todos_legacy'").get().n;
    expect(todos).toBe(0);
    expect(legacy).toBe(0);
    db.close();
  });
});