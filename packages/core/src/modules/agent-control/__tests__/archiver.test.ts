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
  fallbackFacts,
  archiveSubtask,
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

describe('fallbackFacts', () => {
  it('conclusion = 文本首 300 字符，其余空', () => {
    const f = fallbackFacts('结'.repeat(400));
    expect(f.conclusion.length).toBe(300);
    expect(f.tool_chain).toBe('');
    expect(f.key_facts).toEqual([]);
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

  it('LLM 失败 → 写兜底 facts（conclusion = 输入文本）', async () => {
    store.conversationStore.createConversation('c1');
    const todo = store.todoStore.createTodo({ conversationId: 'c1', subject: 't' });

    vi.mocked(generateText).mockRejectedValue(new Error('boom'));

    await archiveSubtask(store.todoStore, todo.id, [{ role: 'user', content: 'hello world' }] as never, {
      model: {} as never,
    });

    const updated = store.todoStore.getTodo(todo.id)!;
    expect((updated.metadata as { facts: { conclusion: string } }).facts.conclusion).toBe('hello world');
  });
});
