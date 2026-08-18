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
  triggerArchiveForTodos,
  hasSubtaskFacts,
  summarizeFactsFromText,
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

describe('summarizeFactsFromText 错误分类', () => {
  // vitest 怪癖：beforeEach 里 mockClear/mockReset 后，被测模块内 await 的 mock
  // 拒绝会被误报为未处理拒绝（实测必失败），故改为在用例体内 mockClear 清计数。

  it('成功 → 返回 facts，无失败原因', async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValue({
      text: '{"tool_chain":"read ×1","conclusion":"完成","key_facts":[]}',
    } as never);
    const r = await summarizeFactsFromText('subtask text', { model: {} as never });
    expect(r.facts?.conclusion).toBe('完成');
    expect(r.reason).toBeUndefined();
  });

  it('配额耗尽 → 原因 quota_exceeded，且不再尝试 fallback 模型', async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockRejectedValue(
      Object.assign(new Error('You have exceeded the monthly usage quota'), { statusCode: 429 }),
    );
    const r = await summarizeFactsFromText('subtask text', {
      model: {} as never,
      fallbackModels: [{} as never],
    });
    expect(r.facts).toBeNull();
    expect(r.reason).toBe('quota_exceeded');
    expect(generateText).toHaveBeenCalledTimes(1); // 配额对全模型生效，中断候选循环
  });

  it('LLM 输出非 JSON → 原因 invalid_response', async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValue({ text: '抱歉，这不是 JSON' } as never);
    const r = await summarizeFactsFromText('subtask text', { model: {} as never });
    expect(r.facts).toBeNull();
    expect(r.reason).toBe('invalid_response');
  });

  it('蒸馏调用契约：紧凑 prompt（JSON 模板/上限/禁围栏）+ json_object + 预算 800（可靠性 P1）', async () => {
    vi.mocked(generateText).mockClear();
    vi.mocked(generateText).mockResolvedValue({
      text: '{"tool_chain":"read ×1","conclusion":"完成","key_facts":[]}',
    } as never);
    await summarizeFactsFromText('subtask text', { model: {} as never });

    const call = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(call.instructions).toContain('tool_chain');
    expect(call.instructions).toContain('key_facts 最多 5 条');
    expect(call.instructions).toContain('不要 markdown 代码围栏');
    expect(call.providerOptions?.openai?.response_format).toEqual({ type: 'json_object' });
    expect(call.maxOutputTokens).toBe(800);
  });

  it('空输入 → 原因 empty_input，不调 LLM', async () => {
    vi.mocked(generateText).mockClear();
    const r = await summarizeFactsFromText('   ', { model: {} as never });
    expect(r.facts).toBeNull();
    expect(r.reason).toBe('empty_input');
    expect(generateText).not.toHaveBeenCalled();
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

describe('triggerArchiveForTodos', () => {
  let tmpDir: string;
  let store: SQLiteDataStore;

  beforeEach(() => {
    vi.mocked(generateText).mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archiver-trigger-test-'));
    store = createSQLiteDataStore({ dataDir: tmpDir });
    store.conversationStore.createConversation('c1');
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeTodo(status: string, metadata: Record<string, unknown> = {}) {
    const t = store.todoStore.createTodo({ conversationId: 'c1', subject: 't', metadata });
    if (status !== 'pending') {
      store.todoStore.updateTodo({ id: t.id, status: status as never });
    }
    return store.todoStore.getTodo(t.id)!;
  }

  it('completed 且有 result → 入队（值为 result 文本），返回 [id]', () => {
    const retries = new Map<string, string>();
    const t = makeTodo('completed', { result: '子 Agent 结论摘要' });
    const enqueued = triggerArchiveForTodos([t.id], store.todoStore, retries);
    expect(enqueued).toEqual([t.id]);
    expect(retries.get(t.id)).toBe('子 Agent 结论摘要');
  });

  it('非 completed（pending/in_progress/failed）→ 不入队', () => {
    const retries = new Map<string, string>();
    const pending = makeTodo('pending', { result: 'r' });
    const doing = makeTodo('in_progress', { result: 'r' });
    const failed = makeTodo('failed', { result: 'r' });
    const enqueued = triggerArchiveForTodos([pending.id, doing.id, failed.id], store.todoStore, retries);
    expect(enqueued).toEqual([]);
    expect(retries.size).toBe(0);
  });

  it('completed 但无 result 文本 → 不入队', () => {
    const retries = new Map<string, string>();
    const t = makeTodo('completed', {});
    expect(triggerArchiveForTodos([t.id], store.todoStore, retries)).toEqual([]);
    expect(retries.size).toBe(0);
  });

  it('已有 facts → 不入队（避免重复提炼）', () => {
    const retries = new Map<string, string>();
    const t = makeTodo('completed', { result: 'r', facts: { conclusion: '已有', key_facts: [], tool_chain: '' } });
    expect(triggerArchiveForTodos([t.id], store.todoStore, retries)).toEqual([]);
    expect(retries.size).toBe(0);
  });

  it('多个 todo：只入队合法项', () => {
    const retries = new Map<string, string>();
    const ok = makeTodo('completed', { result: '结论A' });
    const empty = makeTodo('completed', {});
    const failed = makeTodo('failed', { result: 'r' });
    const enqueued = triggerArchiveForTodos([ok.id, empty.id, failed.id], store.todoStore, retries);
    expect(enqueued).toEqual([ok.id]);
    expect(retries.size).toBe(1);
  });
});
