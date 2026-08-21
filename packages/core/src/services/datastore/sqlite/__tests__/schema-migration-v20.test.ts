import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSQLiteDataStore } from '../sqlite-data-store';
import { getDatabase } from '../native-loader';

describe('Schema v20 migration (agent_runs exhausted + stop_reason)', () => {
  let tmpDir: string;
  let store: ReturnType<typeof createSQLiteDataStore>;

  afterEach(() => {
    store?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * 造一个 v19 数据库：先建出完整的当前 schema（v20），再把 agent_runs
   * 降回 v19 形态（无 stop_reason 列、CHECK 不含 'exhausted'），并置 user_version=19。
   * 这样重开后只触发 v20 重建，且其余表完整，不会因缺列报错。
   */
  function downgradeToV19(dbPath: string): void {
    const Database = getDatabase();
    const db = new Database(dbPath) as unknown as {
      exec(sql: string): void;
      pragma(pragma: string): unknown;
      close(): void;
    };
    db.exec(`
      DROP TABLE agent_runs;
      CREATE TABLE agent_runs (
        conversation_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'running'
          CHECK(status IN ('running', 'paused_approval', 'completed', 'failed')),
        step_count INTEGER DEFAULT 0,
        accumulated_text TEXT DEFAULT '',
        tools_used TEXT DEFAULT '[]',
        error TEXT,
        pending_approval_id TEXT,
        started_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      -- 降级后重放一条 legacy 行，模拟旧库存量数据
      INSERT INTO agent_runs (conversation_id, status, step_count, accumulated_text, tools_used)
        VALUES ('c1', 'completed', 12, 'legacy-text', '[]');
    `);
    db.pragma('user_version = 19');
    db.close();
  }

  it('migrates v19 → v20: preserves rows, adds stop_reason, accepts exhausted', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-v20-migration-'));
    const dbPath = path.join(tmpDir, 'chat.db');

    // 先建出完整 v20 schema 并建一个会话，再降级 agent_runs 为 v19 形态
    const seed = createSQLiteDataStore({ dataDir: tmpDir });
    seed.conversationStore.createConversation('c1');
    seed.close();

    downgradeToV19(dbPath);

    store = createSQLiteDataStore({ dataDir: tmpDir });

    // 行保留，未丢数据
    expect(store.agentRunStore.getRun('c1')?.accumulatedText).toBe('legacy-text');

    // 新终态 exhausted + stop_reason 可写入（旧 CHECK 会拒绝）
    store.agentRunStore.exhaustRun('c1', 'step_limit');
    expect(store.agentRunStore.getRun('c1')).toMatchObject({
      status: 'exhausted',
      stopReason: 'step_limit',
    });
  });
});
