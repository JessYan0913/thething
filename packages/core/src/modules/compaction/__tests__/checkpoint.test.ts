import { describe, it, expect, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import type { UIMessage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore, StoredSummary } from '../../../primitives/datastore/types';
import { applyCheckpointOnLoad, maybeCheckpointAfterRun, CHECKPOINT_SUMMARY_ID_PREFIX } from '../checkpoint';

// ============================================================
// 8.5 compaction checkpoint 持久化
// 见 docs/compaction-execution-plan.md 步骤 8.5
// ============================================================

function msg(id: string, text: string): ModelMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as ModelMessage;
}

function storeWith(summary: StoredSummary | null): DataStore {
  return {
    summaryStore: {
      getSummaryByConversation: () => summary,
    },
  } as unknown as DataStore;
}

function makeSummary(overrides: Partial<StoredSummary>): StoredSummary {
  return {
    id: 's1',
    conversationId: 'c1',
    summary: 'previous work summary',
    compactedAt: '2026-07-18',
    lastMessageOrder: 2,
    preCompactTokenCount: 0,
    anchorMessageId: null,
    ...overrides,
  };
}

const full = [msg('m1', 'a'), msg('m2', 'b'), msg('m3', 'c'), msg('m4', 'd')];

describe('applyCheckpointOnLoad', () => {
  it('returns full history when there is no summary', () => {
    expect(applyCheckpointOnLoad(full, 'c1', storeWith(null))).toBe(full);
  });

  it('returns full history when the summary has no anchor', () => {
    const s = makeSummary({ anchorMessageId: null });
    expect(applyCheckpointOnLoad(full, 'c1', storeWith(s))).toBe(full);
  });

  it('returns full history when the anchor id is not found (never loses messages)', () => {
    const s = makeSummary({ anchorMessageId: 'does-not-exist' });
    expect(applyCheckpointOnLoad(full, 'c1', storeWith(s))).toBe(full);
  });

  it('collapses history to [summary, ...after-anchor] when anchor matches', () => {
    const s = makeSummary({ anchorMessageId: 'm2' });
    const result = applyCheckpointOnLoad(full, 'c1', storeWith(s));
    // m1,m2 → summary; m3,m4 kept
    expect(result.length).toBe(3);
    expect((result[0] as any).id).toContain(CHECKPOINT_SUMMARY_ID_PREFIX);
    // 摘要消息必须是 UIMessage .parts 格式(route 层随后要过 validateUIMessages)
    expect((result[0] as any).parts[0].text).toContain('previous work summary');
    expect((result[1] as any).id).toBe('m3');
    expect((result[2] as any).id).toBe('m4');
  });

  it('returns full history when the anchor is the last message (nothing to keep)', () => {
    const s = makeSummary({ anchorMessageId: 'm4' });
    expect(applyCheckpointOnLoad(full, 'c1', storeWith(s))).toBe(full);
  });

  it('falls back to full history when the store throws', () => {
    const throwing = {
      summaryStore: {
        getSummaryByConversation: () => { throw new Error('db error'); },
      },
    } as unknown as DataStore;
    expect(applyCheckpointOnLoad(full, 'c1', throwing)).toBe(full);
  });
});

// ============================================================
// 后台 checkpoint(运行结束后生成摘要落库)
// ============================================================

/** 最小 LanguageModelV3 mock:doGenerate 返回固定文本 */
function mockModel(summaryText: string | Error): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: async () => {
      if (summaryText instanceof Error) throw summaryText;
      return {
        content: [{ type: 'text', text: summaryText }],
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        warnings: [],
      };
    },
    doStream: async () => { throw new Error('not implemented'); },
  } as unknown as LanguageModelV3;
}

function bigMsg(id: string, role: 'user' | 'assistant', size: number): ModelMessage {
  return { id, role, parts: [{ type: 'text', text: 'x'.repeat(size) }] } as ModelMessage;
}

function checkpointStore(existing: StoredSummary | null) {
  const saved: unknown[][] = [];
  const store = {
    summaryStore: {
      getSummaryByConversation: () => existing,
      saveSummary: (...args: unknown[]) => { saved.push(args); return {} as StoredSummary; },
    },
  } as unknown as DataStore;
  return { store, saved };
}

const VALID_SUMMARY = '## 用户目标 / 验收标准\n完成上下文压缩系统的修复工作,验收标准是加载时压缩生效。\n\n## 已完成步骤 & 关键结论\n定位并修复了双轨格式缺陷。';

describe('maybeCheckpointAfterRun', () => {
  it('does nothing below the trigger watermark', async () => {
    const { store, saved } = checkpointStore(null);
    const messages = [bigMsg('m1', 'user', 100), bigMsg('m2', 'assistant', 100), bigMsg('m3', 'user', 100), bigMsg('m4', 'assistant', 100)];
    const ok = await maybeCheckpointAfterRun(messages, {
      conversationId: 'c1', dataStore: store, model: mockModel(VALID_SUMMARY), modelName: 'test-model', contextLimit: 128_000,
    });
    expect(ok).toBe(false);
    expect(saved.length).toBe(0);
  });

  it('generates and persists summary with anchor above the watermark', async () => {
    const { store, saved } = checkpointStore(null);
    // contextLimit 1000 tokens → 水位线 500;每条 2000 字符 ≈ 数百 tokens
    const messages = [
      bigMsg('m1', 'user', 2000), bigMsg('m2', 'assistant', 2000),
      bigMsg('m3', 'user', 2000), bigMsg('m4', 'assistant', 2000),
      bigMsg('m5', 'user', 200), bigMsg('m6', 'assistant', 200),
    ];
    const ok = await maybeCheckpointAfterRun(messages, {
      conversationId: 'c1', dataStore: store, model: mockModel(VALID_SUMMARY), modelName: 'test-model', contextLimit: 1000,
    });
    expect(ok).toBe(true);
    expect(saved.length).toBe(1);
    // saveSummary(conversationId, summary, lastOrder, tokenCount, anchorMessageId)
    const [convId, summary, , , anchorId] = saved[0];
    expect(convId).toBe('c1');
    expect(summary).toBe(VALID_SUMMARY);
    // 锚点必须落在消息 id 上,且尾部至少保留 2 条
    expect(['m1', 'm2', 'm3', 'm4']).toContain(anchorId);
  });

  it('does not persist when the LLM fails (no template fallback in background)', async () => {
    const { store, saved } = checkpointStore(null);
    const messages = [
      bigMsg('m1', 'user', 2000), bigMsg('m2', 'assistant', 2000),
      bigMsg('m3', 'user', 2000), bigMsg('m4', 'assistant', 2000),
    ];
    const ok = await maybeCheckpointAfterRun(messages, {
      conversationId: 'c1', dataStore: store, model: mockModel(new Error('api down')), modelName: 'test-model', contextLimit: 1000,
    });
    expect(ok).toBe(false);
    expect(saved.length).toBe(0);
  }, 15_000);

  it('summarizes incrementally from the existing anchor', async () => {
    const existing = makeSummary({ anchorMessageId: 'm2', summary: 'old summary content here' });
    const { store, saved } = checkpointStore(existing);
    const messages = [
      bigMsg('m1', 'user', 2000), bigMsg('m2', 'assistant', 2000),
      bigMsg('m3', 'user', 2000), bigMsg('m4', 'assistant', 2000),
      bigMsg('m5', 'user', 200), bigMsg('m6', 'assistant', 200),
    ];
    const ok = await maybeCheckpointAfterRun(messages, {
      conversationId: 'c1', dataStore: store, model: mockModel(VALID_SUMMARY), modelName: 'test-model', contextLimit: 1000,
    });
    expect(ok).toBe(true);
    // 新锚点必须在旧锚点(m2)之后
    const anchorId = saved[0][4];
    expect(['m3', 'm4']).toContain(anchorId);
  });

  it('never throws even when the store blows up', async () => {
    const store = {
      summaryStore: {
        getSummaryByConversation: () => { throw new Error('db gone'); },
      },
    } as unknown as DataStore;
    const messages = [
      bigMsg('m1', 'user', 2000), bigMsg('m2', 'assistant', 2000),
      bigMsg('m3', 'user', 2000), bigMsg('m4', 'assistant', 2000),
    ];
    const ok = await maybeCheckpointAfterRun(messages, {
      conversationId: 'c1', dataStore: store, model: mockModel(VALID_SUMMARY), modelName: 'test-model', contextLimit: 1000,
    });
    expect(ok).toBe(false);
  });
});
