// ============================================================
// Archiver - 子任务归档器 测试
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

import { generateText } from 'ai';
import {
  renderSubtaskText,
  parseFactsJson,
  archiveSubtask,
  retryPendingArchives,
  hasSubtaskFacts,
} from '../archiver';
import { createSQLiteDataStore } from '../../../services/datastore/sqlite/sqlite-data-store';
import type { SQLiteDataStore } from '../../../services/datastore/sqlite/sqlite-data-store';

describe('renderSubtaskText', () => {
  it('提取 assistant 文本与工具输出', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'doing' }] },
      { role: 'assistant', content: [{ type: 'tool-read_file', toolCallId: '1', output: { type: 'text', value: '/a.ts' } }] },
    ] as never;
    const text = renderSubtaskText(msgs);
    expect(text).toContain('hello');
    expect(text).toContain('doing');
    expect(text).toContain('/a.ts');
  });
});

describe('parseFactsJson', () => {
  it('解析有效 JSON（容忍代码围栏）', () => {
    const f = parseFactsJson('```json\n{"tool_chain":"read ×1","conclusion":"完成","key_facts":[{"x":1}]}\n```');
    expect(f?.tool_chain).toBe('read ×1');
    expect(f?.conclusion).toBe('完成');
    expect(f?.key_facts).toHaveLength(1);
  });

  it('缺 conclusion/tool_chain 或非法 JSON → null', () => {
    expect(parseFactsJson('not json')).toBeNull();
    expect(parseFactsJson('{"conclusion":"x"}')).toBeNull();
  });
});

describe('archiveSubtask', () => {
  let tmpDir: string;
  let store: SQLiteDataStore;

  beforeEach(() => {
    vi.mocked(generateText).mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archiver-test-'));
    store = createSQLiteDataStore({ dataDir: tmpDir });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('LLM 成功 → 写 facts，保留 result 字符串', async () => {
    store.conversationStore.createConversation('c1');
    const todo = store.todoStore.createTodo({
      conversationId: 'c1', subject: 't', metadata: { result: 'result-string' },
    });

    vi.mocked(generateText).mockResolvedValue({
      text: '{"tool_chain":"read ×1","conclusion":"完成","key_facts":[{"type":"file"}]}',
    } as never);

    const facts = await archiveSubtask(store.todoStore, todo.id, [{ role: 'user', content: 'x' }] as never, {
      model: {} as never,
    });

    expect(facts?.conclusion).toBe('完成');
    const updated = store.todoStore.getTodo(todo.id)!;
    expect((updated.metadata as { facts: { conclusion: string } }).facts.conclusion).toBe('完成');
    expect(updated.metadata.result).toBe('result-string'); // result 保留
  });

  it('LLM 失败 → 跳过写 facts，返回 null，保留 result', async () => {
    store.conversationStore.createConversation('c1');
    const todo = store.todoStore.createTodo({
      conversationId: 'c1', subject: 't', metadata: { result: 'kept-result' },
    });

    vi.mocked(generateText).mockRejectedValue(new Error('boom'));

    const facts = await archiveSubtask(
      store.todoStore,
      todo.id,
      [{ role: 'user', content: 'hello world' }] as never,
      { model: {} as never },
    );

    expect(facts).toBeNull();
    const updated = store.todoStore.getTodo(todo.id)!;
    expect(updated.metadata.facts).toBeUndefined(); // 未写不完整 facts
    expect(updated.metadata.result).toBe('kept-result'); // result 保留
  });
});

describe('retryPendingArchives', () => {
  let tmpDir: string;
  let store: SQLiteDataStore;

  beforeEach(() => {
    vi.mocked(generateText).mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archiver-retry-test-'));
    store = createSQLiteDataStore({ dataDir: tmpDir });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function completedTodo(metadata: Record<string, unknown> = {}) {
    store.conversationStore.createConversation('c1');
    const t = store.todoStore.createTodo({ conversationId: 'c1', subject: 't', metadata });
    store.todoStore.updateTodo({ id: t.id, status: 'completed', metadata: { result: 'r' } });
    return store.todoStore.getTodo(t.id)!;
  }

  it('重试成功 → 写 facts，清出队列，不触发 onRetryFailed', async () => {
    const todo = completedTodo();
    vi.mocked(generateText).mockResolvedValue({
      text: '{"tool_chain":"read ×1","conclusion":"重试结论","key_facts":[]}',
    } as never);

    const pending = new Map([[todo.id, 'subtask text']]);
    const onRetryFailed = vi.fn();
    const retried = await retryPendingArchives(pending, {
      store: store.todoStore,
      model: {} as never,
      onRetryFailed,
    });

    expect(retried).toEqual([todo.id]);
    expect(pending.size).toBe(0);
    expect(onRetryFailed).not.toHaveBeenCalled();
    expect(store.todoStore.getTodo(todo.id)!.metadata.facts).toMatchObject({ conclusion: '重试结论' });
    // result 保留
    expect(store.todoStore.getTodo(todo.id)!.metadata.result).toBe('r');
  });

  it('重试仍失败 → onRetryFailed 触发，不写 facts，清出队列（最多一次）', async () => {
    const todo = completedTodo();
    vi.mocked(generateText).mockRejectedValue(new Error('boom'));

    const pending = new Map([[todo.id, 'subtask text']]);
    const onRetryFailed = vi.fn();
    const retried = await retryPendingArchives(pending, {
      store: store.todoStore,
      model: {} as never,
      onRetryFailed,
    });

    expect(onRetryFailed).toHaveBeenCalledWith(todo.id);
    expect(pending.size).toBe(0);
    expect(store.todoStore.getTodo(todo.id)!.metadata.facts).toBeUndefined();
  });

  it('todo 已有 facts → 跳过重试，清出队列，不调 LLM', async () => {
    const todo = completedTodo({
      facts: { conclusion: '已有结论', key_facts: [], tool_chain: '' },
    });

    const pending = new Map([[todo.id, 'subtask text']]);
    const retried = await retryPendingArchives(pending, {
      store: store.todoStore,
      model: {} as never,
    });

    expect(retried).toEqual([]);
    expect(pending.size).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('todo 已不存在 → 跳过重试，清出队列', async () => {
    const pending = new Map([['todo-missing', 'subtask text']]);
    const retried = await retryPendingArchives(pending, {
      store: store.todoStore,
      model: {} as never,
    });

    expect(retried).toEqual([]);
    expect(pending.size).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe('hasSubtaskFacts', () => {
  it('有非空 conclusion → true', () => {
    expect(hasSubtaskFacts({ metadata: { facts: { conclusion: '完成' } } } as never)).toBe(true);
  });

  it('无 facts / conclusion 为空 → false', () => {
    expect(hasSubtaskFacts({ metadata: {} } as never)).toBe(false);
    expect(hasSubtaskFacts({ metadata: { facts: { conclusion: '  ' } } } as never)).toBe(false);
    expect(hasSubtaskFacts({ metadata: { result: '只有 result' } } as never)).toBe(false);
  });
});
