// ============================================================
// Doctor Repairs — 修复行为测试
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { resolveLayout } from '../../../services/config/layout';
import { createSQLiteDataStore, type SQLiteDataStore } from '../../../services/datastore/sqlite/sqlite-data-store';
import { getDatabase } from '../../../services/datastore/sqlite/native-loader';
import { createDoctorContext } from '../index';
import { applyRepair } from '../repairs';
import type { DoctorContext } from '../types';

function msg(id: string, role: 'user' | 'assistant' = 'user', text = 'hello'): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage;
}

describe('Doctor repairs', () => {
  let tmpDir: string;
  let store: SQLiteDataStore | null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-repairs-'));
    store = null;
  });

  afterEach(() => {
    store?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeCtx(): DoctorContext {
    const layout = resolveLayout({ resourceRoot: tmpDir, configDir: tmpDir, dataDir: tmpDir });
    return createDoctorContext({ layout, dataStore: store ?? undefined });
  }

  function setupStore(): SQLiteDataStore {
    store = createSQLiteDataStore({ dataDir: tmpDir });
    return store;
  }

  function rawDb() {
    const db = new (getDatabase())(path.join(tmpDir, 'chat.db'), { fileMustExist: true });
    // 种子数据需插入指向不存在会话的行（测无主行），better-sqlite3 默认开 FK
    db.pragma('foreign_keys = OFF');
    return db;
  }

  it('prune-conversations：剥离瞬态 part + 删除孤儿', async () => {
    const s = setupStore();
    const cid = 'conv-p';
    s.messageStore.commitUserMessage(cid, msg('u1'));
    // 给可达消息 u1 塞一个瞬态 part（绕过写入剥离）
    const withTransient: UIMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'data-bash-output', output: 'x', toolCallId: 'c1' },
      ],
    } as UIMessage;
    const db = rawDb();
    db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(JSON.stringify(withTransient), 'u1');
    // 插入不可达孤儿
    db.prepare(
      'INSERT INTO messages (id, conversation_id, parent_id, role, content) VALUES (?, ?, ?, ?, ?)',
    ).run('orphan1', cid, 'u1', 'assistant', JSON.stringify(msg('orphan1', 'assistant', 'old')));
    db.close();

    const preview = s.messageStore.analyzePrune(cid);
    expect(preview.deletedOrphans).toBe(1);
    expect(preview.strippedMessages).toBe(1);

    const outcome = await applyRepair(makeCtx(), 'prune-conversations', { confirmed: true });
    expect(outcome.status).toBe('done');

    // 可达消息只剩 u1 且无瞬态 part；孤儿已删
    const remaining = s.messageStore.getMessagesByConversation(cid).map((m) => m.id);
    expect(remaining).toEqual(['u1']);
    const u1 = s.messageStore.getMessagesByConversation(cid)[0];
    expect(u1.parts.some((p) => p.type === 'data-bash-output')).toBe(false);
    const after = s.messageStore.analyzePrune(cid);
    expect(after.deletedOrphans).toBe(0);
    expect(after.strippedMessages).toBe(0);
  });

  it('cleanup-expired-suspended：清掉过期挂起状态、保留未过期', async () => {
    const s = setupStore();
    // 先建会话（store 连接 FK 开启，saveSuspendedState 需要存在的 conversation）
    s.messageStore.commitUserMessage('conv-expired', msg('u1'));
    s.messageStore.commitUserMessage('conv-live', msg('u2'));
    s.suspendedStateStore.saveSuspendedState(
      'conv-expired',
      '{}',
      new Date(Date.now() - 60_000),
      new Date(Date.now() - 30_000),
    );
    s.suspendedStateStore.saveSuspendedState(
      'conv-live',
      '{}',
      new Date(),
      new Date(Date.now() + 3_600_000),
    );
    // 仅未过期的被视为活跃挂起（ISO 日期被 datetime() 正确解析）
    expect(s.suspendedStateStore.getConversationsWithSuspendedStates()).toEqual(['conv-live']);

    const outcome = await applyRepair(makeCtx(), 'cleanup-expired-suspended', { confirmed: true });
    expect(outcome.status).toBe('done');
    expect(s.suspendedStateStore.getConversationsWithSuspendedStates()).toEqual(['conv-live']);
    expect(s.suspendedStateStore.getSuspendedState('conv-expired')).toBeNull();
  });

  it('cleanup-tool-results：删除超过 7 天的会话目录', async () => {
    const dir = path.join(tmpDir, 'tool-results', 'sess-old');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'out.json'), '{}');
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(dir, old, old);
    expect(fs.existsSync(dir)).toBe(true);
    const outcome = await applyRepair(makeCtx(), 'cleanup-tool-results', { confirmed: true });
    expect(outcome.status).toBe('done');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('delete-backup-files：未确认→needs-confirmation；确认→删除', async () => {
    const backup = path.join(tmpDir, 'chat.db.backup-2026-08-11T00-00-00Z');
    fs.writeFileSync(backup, 'x');
    const ctx = makeCtx();

    const unconfirmed = await applyRepair(ctx, 'delete-backup-files', { confirmed: false });
    expect(unconfirmed.status).toBe('needs-confirmation');
    expect(fs.existsSync(backup)).toBe(true);

    const confirmed = await applyRepair(ctx, 'delete-backup-files', { confirmed: true });
    expect(confirmed.status).toBe('done');
    expect(fs.existsSync(backup)).toBe(false);
  });

  it('delete-orphan-rows：仅确认后删除无主行', async () => {
    setupStore();
    const db = rawDb();
    db.prepare(
      "INSERT INTO todos (id, conversation_id, subject, status, blocked_by, blocks, metadata) VALUES ('t1', 'missing-conv', 'x', 'pending', '[]', '[]', '{}')",
    ).run();
    db.close();
    const ctx = makeCtx();

    const unconfirmed = await applyRepair(ctx, 'delete-orphan-rows', { confirmed: false });
    expect(unconfirmed.status).toBe('needs-confirmation');

    const confirmed = await applyRepair(ctx, 'delete-orphan-rows', { confirmed: true });
    expect(confirmed.status).toBe('done');
    const after = rawDb();
    const row = after.prepare('SELECT count(*) AS c FROM todos WHERE id = ?').get('t1') as { c: number };
    after.close();
    expect(row.c).toBe(0);
  });

  it('wal-checkpoint：不抛错', async () => {
    setupStore();
    const outcome = await applyRepair(makeCtx(), 'wal-checkpoint', { confirmed: true });
    expect(['done', 'error']).toContain(outcome.status);
  });

  it('vacuum-chat-db：无活动连接时可执行', async () => {
    const s = setupStore();
    const cid = 'conv-v';
    s.messageStore.commitUserMessage(cid, msg('u1'));
    const batch: UIMessage[] = [];
    for (let i = 0; i < 200; i++) batch.push(msg(`a${i}`, 'assistant', 'y'.repeat(100)));
    s.messageStore.appendMessages(cid, batch);
    s.close();
    store = null;
    const before = fs.statSync(path.join(tmpDir, 'chat.db')).size;
    const outcome = await applyRepair(makeCtx(), 'vacuum-chat-db', { confirmed: true });
    expect(outcome.status).toBe('done');
    const after = fs.statSync(path.join(tmpDir, 'chat.db')).size;
    expect(after).toBeLessThanOrEqual(before);
  });

  it('rebuild-wiki-index：生成 index.md', async () => {
    fs.mkdirSync(path.join(tmpDir, 'wiki', 'user'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'wiki', 'user', 'foo.md'),
      '---\nname: Foo\ndescription: A test page\ncategory: user\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n# Foo',
    );
    const outcome = await applyRepair(makeCtx(), 'rebuild-wiki-index', { confirmed: true });
    expect(outcome.status).toBe('done');
    const index = fs.readFileSync(path.join(tmpDir, 'wiki', 'index.md'), 'utf-8');
    expect(index).toContain('foo.md');
  });
});
