import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSQLiteDataStore } from '../sqlite-data-store';
import { getDatabase } from '../native-loader';

describe('Schema v21 migration (drop agent_status)', () => {
  let tmpDir: string;
  let store: ReturnType<typeof createSQLiteDataStore>;

  afterEach(() => {
    store?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * 造一个 v20 数据库：先建出完整的当前 schema（v21），再手工补出已被废弃的
   * agent_status 表 + 存量行，并置 user_version=20。这样重开后只触发 v21 DROP，
   * 且其余表完整不会因缺表/缺列报错。
   */
  function addLegacyAgentStatus(dbPath: string): void {
    const Database = getDatabase();
    const db = new Database(dbPath) as unknown as {
      exec(sql: string): void;
      pragma(pragma: string): unknown;
      close(): void;
    };
    db.exec(`
      CREATE TABLE agent_status (
        agent_id TEXT PRIMARY KEY,
        is_busy INTEGER NOT NULL DEFAULT 0,
        current_todo_id TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO agent_status (agent_id, is_busy) VALUES ('main', 1);
    `);
    db.pragma('user_version = 20');
    db.close();
  }

  it('migrates v20 → v21: drops the orphaned agent_status table', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-v21-migration-'));
    const dbPath = path.join(tmpDir, 'chat.db');

    // 建出完整 v21 schema 并建一个会话，再补回 legacy agent_status + 存量行
    const seed = createSQLiteDataStore({ dataDir: tmpDir });
    seed.conversationStore.createConversation('c1');
    seed.close();

    addLegacyAgentStatus(dbPath);

    store = createSQLiteDataStore({ dataDir: tmpDir });

    // agent_status 已被删除（不再存在任何读写路径，表不应残留）
    const Database = getDatabase();
    const db = new Database(dbPath, { readonly: true }) as unknown as {
      prepare(sql: string): { get(): { n: number } };
      close(): void;
    };
    const { n } = db
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='agent_status'")
      .get();
    expect(n).toBe(0);
    db.close();

    // 会话数据不受影响
    expect(store.conversationStore.getConversation('c1')?.id).toBe('c1');
  });
});