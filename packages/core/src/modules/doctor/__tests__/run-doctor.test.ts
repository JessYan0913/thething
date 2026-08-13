// ============================================================
// runDoctor — 整报告冒烟测试
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveLayout } from '../../../services/config/layout';
import { createSQLiteDataStore } from '../../../services/datastore/sqlite/sqlite-data-store';
import { createDoctorContext, runDoctor, CHECKS } from '../index';

describe('runDoctor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-run-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('干净布局 → 全 ok、报告形状合法、wiki 项跳过', async () => {
    const store = createSQLiteDataStore({ dataDir: tmpDir });
    // 关闭 store 触发 WAL checkpoint，避免 -wal 与 DB 大小比触发误报
    store.close();

    const layout = resolveLayout({ resourceRoot: tmpDir, configDir: tmpDir, dataDir: tmpDir });
    const report = await runDoctor(createDoctorContext({ layout }));

    expect(report.checks.length).toBe(CHECKS.length);
    expect(report.configDir).toBe(tmpDir);
    expect(report.dataDir).toBe(tmpDir);
    expect(report.summary.ok + report.summary.warn + report.summary.error).toBe(report.checks.length);

    for (const check of report.checks) {
      expect(check.status, `check ${check.id} should be ok`).toBe('ok');
    }
  });

  it('破坏的 chat.db → integrity 报 error 但不 throw', async () => {
    fs.writeFileSync(path.join(tmpDir, 'chat.db'), Buffer.from('garbage-not-a-db'.repeat(50)));
    const layout = resolveLayout({ resourceRoot: tmpDir, configDir: tmpDir, dataDir: tmpDir });
    const report = await runDoctor(createDoctorContext({ layout }));
    expect(report.summary.error).toBeGreaterThan(0);
    expect(report.checks.find((c) => c.id === 'chat-db-integrity')?.status).toBe('error');
  });
});
