import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSQLiteDataStore } from '../../../services/datastore/sqlite/sqlite-data-store';
import { completeGoal, isResumableGoal } from '../goal-state';
import { persistGoal, loadGoal, clearGoalStorage } from '../goal-storage';
import type { GoalState } from '../types';

// ============================================================
// Phase F: goal 持久化（goals 表接入）
// ============================================================
// 验收：
// 1. persistGoal → 可跨实例 loadGoal 水合（SQLite 持久化）
// 2. clearGoalStorage 清墓碑
// 3. isResumableGoal：仅 active/paused 水合（terminal/blocked 不水合，避免跨 run 误判停因）

describe('goal 持久化（Phase F）', () => {
  let tmpDir: string;
  let store: ReturnType<typeof createSQLiteDataStore>;

  afterEach(() => {
    store?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeStore(): ReturnType<typeof createSQLiteDataStore> {
    tmpDir = tmpDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'goal-storage-'));
    return createSQLiteDataStore({ dataDir: tmpDir });
  }

  function baseGoal(over: Partial<GoalState> = {}): GoalState {
    return {
      id: 'g-1',
      objective: '根治 harness 稳定性',
      status: 'active',
      createdAt: 1000,
      updatedAt: 1000,
      turnsExecuted: 1,
      tokensUsed: 0,
      tokenBudget: null,
      blockedCount: 0,
      ...over,
    };
  }

  it('persistGoal → loadGoal 跨实例读回（SQLite 持久化）', () => {
    const a = makeStore();
    persistGoal(a, 'conv-1', baseGoal());
    a.close();

    const b = makeStore();
    const loaded = loadGoal(b, 'conv-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.objective).toBe('根治 harness 稳定性');
    expect(loaded?.status).toBe('active');
    expect(loaded?.turnsExecuted).toBe(1); // JSON 往返不丢数值字段
  });

  it('loadGoal 对无目标会话返回 null', () => {
    store = makeStore();
    expect(loadGoal(store, 'conv-missing')).toBeNull();
  });

  it('clearGoalStorage 删除墓碑：置目标后清除，读回 null', () => {
    store = makeStore();
    persistGoal(store, 'conv-1', baseGoal());
    expect(loadGoal(store, 'conv-1')).not.toBeNull();
    clearGoalStorage(store, 'conv-1');
    expect(loadGoal(store, 'conv-1')).toBeNull();
  });

  it('complete 的目标照常持久化（下一 run 水合做状态判断）', () => {
    store = makeStore();
    const active = baseGoal();
    persistGoal(store, 'conv-1', active);
    const completed = completeGoal(active);
    persistGoal(store, 'conv-1', completed);
    expect(loadGoal(store, 'conv-1')?.status).toBe('complete');
  });

  it('isResumableGoal：仅 active/paused 可水合', () => {
    expect(isResumableGoal(baseGoal())).toBe(true);                              // active
    expect(isResumableGoal(baseGoal({ status: 'paused' }))).toBe(true);          // paused
    expect(isResumableGoal(baseGoal({ status: 'complete' }))).toBe(false);       // terminal
    expect(isResumableGoal(baseGoal({ status: 'budget_limited' }))).toBe(false); // 防 goal_budget 一跳即停
    expect(isResumableGoal(baseGoal({ status: 'max_turns' }))).toBe(false);
    expect(isResumableGoal(baseGoal({ status: 'blocked' }))).toBe(false);        // blocked 不自动复活
    expect(isResumableGoal(null)).toBe(false);
  });
});