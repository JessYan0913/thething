// ============================================================
// Doctor Checks — 单项检查状态测试
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { resolveLayout } from '../../../services/config/layout';
import { createSQLiteDataStore, type SQLiteDataStore } from '../../../services/datastore/sqlite/sqlite-data-store';
import { getDatabase } from '../../../services/datastore/sqlite/native-loader';
import { createDoctorContext, CHECKS } from '../index';
import type { DoctorContext } from '../types';

function msg(id: string, role: 'user' | 'assistant' = 'user', text = 'hello'): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage;
}

describe('Doctor checks', () => {
  let tmpDir: string;
  let store: SQLiteDataStore | null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-checks-'));
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

  async function runCheck(id: string, ctx: DoctorContext) {
    const check = CHECKS.find((c) => c.id === id);
    if (!check) throw new Error(`unknown check ${id}`);
    return check.run(ctx);
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

  describe('chat.db 基础检查', () => {
    it('新库 readable/integrity/schema-version 全 ok', async () => {
      setupStore();
      const ctx = makeCtx();
      expect((await runCheck('chat-db-readable', ctx)).status).toBe('ok');
      expect((await runCheck('chat-db-integrity', ctx)).status).toBe('ok');
      expect((await runCheck('chat-db-schema-version', ctx)).status).toBe('ok');
    });

    it('垃圾文件 → integrity 报 error', async () => {
      fs.writeFileSync(path.join(tmpDir, 'chat.db'), Buffer.from('this is not a sqlite database'.repeat(20)));
      const ctx = makeCtx();
      expect((await runCheck('chat-db-integrity', ctx)).status).toBe('error');
    });

    it('WAL 超过 DB 1/3 → warn 且 fixHint=wal-checkpoint', async () => {
      fs.writeFileSync(path.join(tmpDir, 'chat.db'), Buffer.alloc(1000));
      fs.writeFileSync(path.join(tmpDir, 'chat.db-wal'), Buffer.alloc(100000));
      const ctx = makeCtx();
      const r = await runCheck('chat-db-wal-size', ctx);
      expect(r.status).toBe('warn');
      expect(r.fixHint).toBe('wal-checkpoint');
    });

    it('删除后不 VACUUM → 页膨胀 warn 且 fixHint=vacuum-chat-db', async () => {
      const s = setupStore();
      const cid = 'conv-bloat';
      s.messageStore.commitUserMessage(cid, msg('u1'));
      const assistant = (i: number) => msg(`a${i}`, 'assistant', `payload-${i}-${'x'.repeat(200)}`);
      const batch: UIMessage[] = [];
      for (let i = 0; i < 300; i++) batch.push(assistant(i));
      s.messageStore.appendMessages(cid, batch);
      // 不 VACUUM 地删光 → freelist 增长
      const db = rawDb();
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(cid);
      db.close();
      const ctx = makeCtx();
      const r = await runCheck('chat-db-bloat', ctx);
      expect(r.status).toBe('warn');
      expect(r.fixHint).toBe('vacuum-chat-db');
    });
  });

  describe('孤儿检查', () => {
    it('不可达消息 → 孤儿 warn 且 fixHint=prune-conversations', async () => {
      const s = setupStore();
      const cid = 'conv-orphan';
      s.messageStore.commitUserMessage(cid, msg('u1'));
      // 插入 u1 的子节点 orphan1：head 是 u1，向上回溯不可达 orphan1
      const db = rawDb();
      db.prepare(
        'INSERT INTO messages (id, conversation_id, parent_id, role, content) VALUES (?, ?, ?, ?, ?)',
      ).run('orphan1', cid, 'u1', 'assistant', JSON.stringify(msg('orphan1', 'assistant', 'old-version')));
      db.close();
      const ctx = makeCtx();
      const r = await runCheck('chat-db-orphans', ctx);
      expect(r.status).toBe('warn');
      expect(r.fixHint).toBe('prune-conversations');
    });

    it('无主 todos 行 → 无主行 warn 且 fixHint=delete-orphan-rows', async () => {
      setupStore();
      const db = rawDb();
      db.prepare(
        "INSERT INTO todos (id, conversation_id, subject, status, blocked_by, blocks, metadata) VALUES ('t1', 'missing-conv', 'x', 'pending', '[]', '[]', '{}')",
      ).run();
      db.close();
      const ctx = makeCtx();
      const r = await runCheck('chat-db-orphan-rows', ctx);
      expect(r.status).toBe('warn');
      expect(r.fixHint).toBe('delete-orphan-rows');
    });
  });

  describe('数据目录检查', () => {
    it('memory 文件缺 frontmatter → warn', async () => {
      fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'memory', 'bad.md'), 'no frontmatter here');
      const ctx = makeCtx();
      expect((await runCheck('memory-files-valid', ctx)).status).toBe('warn');
    });

    it('mcp.json 非法 JSON → error', async () => {
      fs.writeFileSync(path.join(tmpDir, 'mcp.json'), '{ not valid json');
      const ctx = makeCtx();
      expect((await runCheck('mcp-json-valid', ctx)).status).toBe('error');
    });

    it('mcp-auth 0644 → error；0600 → ok', async () => {
      const dir = path.join(tmpDir, 'mcp-auth');
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, 'state.json');
      fs.writeFileSync(f, '{}', { mode: 0o644 });
      const ctx = makeCtx();
      expect((await runCheck('mcp-auth-permissions', ctx)).status).toBe('error');
      fs.chmodSync(f, 0o600);
      expect((await runCheck('mcp-auth-permissions', ctx)).status).toBe('ok');
    });
  });

  describe('wiki 检查', () => {
    it('有页面但无 index.md → 索引漂移 warn 且 fixHint=rebuild-wiki-index', async () => {
      fs.mkdirSync(path.join(tmpDir, 'wiki', 'user'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'wiki', 'user', 'foo.md'), '# Foo');
      const ctx = makeCtx();
      const r = await runCheck('wiki-index-drift', ctx);
      expect(r.status).toBe('warn');
      expect(r.fixHint).toBe('rebuild-wiki-index');
    });
  });
});
