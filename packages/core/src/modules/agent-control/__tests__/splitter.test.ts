// ============================================================
// Force Splitter - 强制拆分器 测试
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

import { generateText } from 'ai';
import { fallbackSplit, parseSplitJson, splitTodo } from '../splitter';
import { createSQLiteDataStore } from '../../../services/datastore/sqlite/sqlite-data-store';
import type { SQLiteDataStore } from '../../../services/datastore/sqlite/sqlite-data-store';

describe('fallbackSplit', () => {
  it('短输入（<maxLen）聚合为单块', () => {
    // 设计语义：按句号切分后聚合成 ≤maxLen 的块，短句会被拼接
    expect(fallbackSplit('步骤一。步骤二。步骤三')).toEqual(['步骤一步骤二步骤三']);
  });

  it('长输入按句号切分并聚合为 ≤maxLen 的多块', () => {
    const segs = fallbackSplit('句。'.repeat(600), 500); // 1200 字符，含句号
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.length).toBeLessThanOrEqual(500);
  });
});

describe('parseSplitJson', () => {
  it('解析有效数组（容忍围栏），过滤缺 subject', () => {
    const items = parseSplitJson('```json\n[{"subject":"A","verify":"跑测试"},{"subject":"B"}]```');
    expect(items?.length).toBe(2);
    expect(items?.[0].verify).toBe('跑测试');
  });

  it('非数组 / 非法 / 少于 2 项 → null', () => {
    expect(parseSplitJson('not json')).toBeNull();
    expect(parseSplitJson('[{"subject":"A"}]')).toBeNull(); // 只有 1 项
    expect(parseSplitJson('{"subject":"A"}')).toBeNull();
  });
});

describe('splitTodo', () => {
  let tmpDir: string;
  let store: SQLiteDataStore;

  beforeEach(() => {
    vi.mocked(generateText).mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splitter-test-'));
    store = createSQLiteDataStore({ dataDir: tmpDir });
    store.conversationStore.createConversation('c1');
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('LLM 拆分成功 → 取消原 todo + 建新子任务', async () => {
    const todo = store.todoStore.createTodo({ conversationId: 'c1', subject: '过大任务' });
    vi.mocked(generateText).mockResolvedValue({
      text: '[{"subject":"子任务A","verify":"跑测试"},{"subject":"子任务B"}]',
    } as never);

    const created = await splitTodo(store.todoStore, todo, { model: {} as never });

    expect(created.length).toBe(2);
    expect(store.todoStore.getTodo(todo.id)!.status).toBe('cancelled');
    const all = store.todoStore.getTodosByConversation('c1');
    expect(all.some((t) => t.subject === '子任务A')).toBe(true);
    expect(all.some((t) => t.subject === '子任务B')).toBe(true);
  });

  it('LLM 失败 → 兜底语义切分（长任务可拆出 ≥2）', async () => {
    const todo = store.todoStore.createTodo({ conversationId: 'c1', subject: '句。'.repeat(600) });
    vi.mocked(generateText).mockRejectedValue(new Error('boom'));

    const created = await splitTodo(store.todoStore, todo, { model: {} as never });

    expect(created.length).toBeGreaterThanOrEqual(2);
    expect(store.todoStore.getTodo(todo.id)!.status).toBe('cancelled');
  });

  it('已原子（无法拆出 ≥2）→ 返回空，不取消不改动', async () => {
    const todo = store.todoStore.createTodo({ conversationId: 'c1', subject: '单一原子任务' });
    vi.mocked(generateText).mockRejectedValue(new Error('boom'));

    const created = await splitTodo(store.todoStore, todo, { model: {} as never });

    expect(created).toEqual([]);
    expect(store.todoStore.getTodo(todo.id)!.status).toBe('pending'); // 未取消
  });
});
