import { describe, it, expect, vi } from 'vitest';
import type { UIMessage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore, StoredSummary } from '../../../primitives/datastore/types';
import { applyCheckpointOnLoad, maybeCheckpointAfterRun, CHECKPOINT_SUMMARY_ID_PREFIX } from '../checkpoint';

// ============================================================
// 8.5 compaction checkpoint 持久化
// 见 docs/context-compaction-architecture.md 步骤 8.5
// ============================================================

function msg(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as unknown as UIMessage;
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

const full: UIMessage[] = [msg('m1', 'a'), msg('m2', 'b'), msg('m3', 'c'), msg('m4', 'd')];

describe('applyCheckpointOnLoad', () => {
  it('returns full history when there is no summary', () => {
    expect(applyCheckpointOnLoad(full, 'c1', storeWith(null)).messages).toBe(full);
  });

  it('returns full history when the summary has no anchor', () => {
    const s = makeSummary({ anchorMessageId: null });
    expect(applyCheckpointOnLoad(full, 'c1', storeWith(s)).messages).toBe(full);
  });

  it('returns full history when the anchor id is not found (never loses messages)', () => {
    const s = makeSummary({ anchorMessageId: 'does-not-exist' });
    expect(applyCheckpointOnLoad(full, 'c1', storeWith(s)).messages).toBe(full);
  });

  it('collapses history to [summary, ...after-anchor] when anchor matches', () => {
    const s = makeSummary({ anchorMessageId: 'm2' });
    const result = applyCheckpointOnLoad(full, 'c1', storeWith(s));
    // m1,m2 → summary; m3,m4 kept
    expect(result.messages.length).toBe(3);
    expect((result.messages[0] as any).id).toContain(CHECKPOINT_SUMMARY_ID_PREFIX);
    // 摘要消息必须是 UIMessage .parts 格式(route 层随后要过 validateUIMessages)
    expect((result.messages[0] as any).parts[0].text).toContain('previous work summary');
    expect((result.messages[1] as any).id).toBe('m3');
    expect((result.messages[2] as any).id).toBe('m4');
  });

  it('returns full history when the anchor is the last message (nothing to keep)', () => {
    const s = makeSummary({ anchorMessageId: 'm4' });
    expect(applyCheckpointOnLoad(full, 'c1', storeWith(s)).messages).toBe(full);
  });

  it('falls back to full history when the store throws', () => {
    const throwing = {
      summaryStore: {
        getSummaryByConversation: () => { throw new Error('db error'); },
      },
    } as unknown as DataStore;
    expect(applyCheckpointOnLoad(full, 'c1', throwing).messages).toBe(full);
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

function bigMsg(id: string, role: 'user' | 'assistant', size: number): UIMessage {
  return { id, role, parts: [{ type: 'text', text: 'x'.repeat(size) }] } as unknown as UIMessage;
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

  it('summarizes huge single messages instead of keeping them (root cause: msg#4 pollution)', async () => {
    // 复现:中间一条超大消息(>= keepBudget)。旧逻辑 splitIndex 落在它身上,
    // 把它留在 newerMessages(保留段),污染上下文。修复后它应进 olderMessages(摘要段)。
    // contextLimit=1000 -> keepBudget=300。m2(2000 chars ~500 tokens)>=300 -> 超大。
    const { store, saved } = checkpointStore(null);
    const messages = [
      bigMsg('m1', 'user', 200),      // 小
      bigMsg('m2', 'assistant', 2000), // 超大(>= keepBudget)
      bigMsg('m3', 'user', 200),      // 小
      bigMsg('m4', 'assistant', 200), // 小
      bigMsg('m5', 'user', 200),      // 小
    ];
    const ok = await maybeCheckpointAfterRun(messages, {
      conversationId: 'c1', dataStore: store, model: mockModel(VALID_SUMMARY), modelName: 'test-model', contextLimit: 1000,
    });
    expect(ok).toBe(true);
    const anchorId = saved[0][4] as string;
    // anchor 必须是 m2 或之后(m2 被摘要覆盖,而非留在保留段)
    expect(['m2', 'm3', 'm4']).toContain(anchorId);
    expect(anchorId).not.toBe('m1'); // 旧 bug:anchor=m1,m2 留在保留段
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

// ============================================================
// 孤儿锚点自愈
// ============================================================
// regenerate/edit 让旧 checkpoint anchor 失效 -> applyCheckpointOnLoad 回退全量 ->
// Layer 2 meta 化的旧文件路径污染上下文。selfHealOrphanedCheckpoint 检测孤儿并强制重建。

/** 带 messageStore 的 mock:summaryStore + messageStore.getMessagesByConversation */
function storeWithMessages(existing: StoredSummary | null, dbMessages: UIMessage[]) {
  const saved: unknown[][] = [];
  let current = existing;
  const store = {
    summaryStore: {
      getSummaryByConversation: () => current,
      saveSummary: (conversationId: string, summary: string, lastOrder: number, tokenCount: number, anchorId?: string | null) => {
        saved.push([conversationId, summary, lastOrder, tokenCount, anchorId]);
        // 更新 current,使后续 getSummaryByConversation 返回新摘要(模拟真实落库)
        current = makeSummary({ summary, anchorMessageId: anchorId ?? null, lastMessageOrder: lastOrder, preCompactTokenCount: tokenCount });
        return {} as StoredSummary;
      },
    },
    messageStore: {
      getMessagesByConversation: () => dbMessages,
    },
  } as unknown as DataStore;
  return { store, saved };
}

import { selfHealOrphanedCheckpoint } from '../checkpoint';

describe('selfHealOrphanedCheckpoint', () => {
  it('no-op when there is no stored summary', async () => {
    const messages = [bigMsg('m1', 'user', 2000), bigMsg('m2', 'assistant', 2000)];
    const { store, saved } = storeWithMessages(null, messages);
    const result = await selfHealOrphanedCheckpoint(messages as unknown as import("ai").ModelMessage[], {
      conversationId: 'c1', dataStore: store, model: mockModel(VALID_SUMMARY), modelName: 'test-model', contextLimit: 1000,
    });
    expect(result).toBe(messages);
    expect(saved.length).toBe(0);
  });

  it('no-op when anchor is valid (in active DB messages)', async () => {
    const existing = makeSummary({ anchorMessageId: 'm2' });
    const messages = [bigMsg('m1', 'user', 2000), bigMsg('m2', 'assistant', 2000), bigMsg('m3', 'user', 200)];
    const { store, saved } = storeWithMessages(existing, messages);
    const result = await selfHealOrphanedCheckpoint(messages as unknown as import("ai").ModelMessage[], {
      conversationId: 'c1', dataStore: store, model: mockModel(VALID_SUMMARY), modelName: 'test-model', contextLimit: 1000,
    });
    expect(result).toBe(messages); // 未触发自愈
    expect(saved.length).toBe(0);
  });

  it('heals when anchor is orphaned: forces checkpoint + applies new summary prefix', async () => {
    // 旧 anchor 'old-orphan' 不在 DB 活跃消息里(被 regenerate 替换)
    const existing = makeSummary({ anchorMessageId: 'old-orphan', summary: 'stale summary' });
    const dbMessages = [
      bigMsg('m1', 'user', 2000), bigMsg('m2', 'assistant', 2000),
      bigMsg('m3', 'user', 2000), bigMsg('m4', 'assistant', 2000),
      bigMsg('m5', 'user', 200), bigMsg('m6', 'assistant', 200),
    ];
    const { store, saved } = storeWithMessages(existing, dbMessages);
    const result = await selfHealOrphanedCheckpoint(dbMessages as unknown as import("ai").ModelMessage[], {
      conversationId: 'c1', dataStore: store, model: mockModel(VALID_SUMMARY), modelName: 'test-model', contextLimit: 1000,
    });
    // 强制重建:saveSummary 被调用(新 anchor 落库)
    expect(saved.length).toBe(1);
    // 新 anchor 必须是当前活跃消息之一(非孤儿)
    const newAnchor = saved[0][4] as string;
    expect(dbMessages.some((m) => (m as unknown as { id: string }).id === newAnchor)).toBe(true);
    // 自愈后用摘要替换污染前缀:消息数减少
    expect(result.length).toBeLessThan(dbMessages.length);
    // 首条是摘要消息
    expect((result[0] as any).parts[0].text).toContain('previous conversation');
  });

  it('falls back to full when LLM fails (no history lost)', async () => {
    const existing = makeSummary({ anchorMessageId: 'old-orphan' });
    const dbMessages = [bigMsg('m1', 'user', 2000), bigMsg('m2', 'assistant', 2000)];
    const { store, saved } = storeWithMessages(existing, dbMessages);
    const result = await selfHealOrphanedCheckpoint(dbMessages as unknown as import("ai").ModelMessage[], {
      conversationId: 'c1', dataStore: store, model: mockModel(new Error('llm down')), modelName: 'test-model', contextLimit: 1000,
    });
    // LLM 失败 -> 不丢历史,回退全量
    expect(result).toBe(dbMessages);
    expect(saved.length).toBe(0);
  });

  it('heals stale summary missing provenance section (pre-4d461c0 format)', async () => {
    const existing = makeSummary({
      anchorMessageId: 'm1',
      summary: '## 用户目标\n学习 douyin\n## 已完成\n读了 douyin_downloader.py',
    });
    // m2 是带 tool-call 的消息(key=web_fetch URL),action log 才非空
    const toolMsgM2: UIMessage = {
      id: 'm2', role: 'assistant',
      parts: [{ type: 'tool-web_fetch' as any, toolCallId: 'tc-1', state: 'output-available', input: { url: 'https://raw.githubusercontent.com/yzfly/douyin-mcp-server/main/douyin_downloader.py' }, output: { type: 'text', value: 'def download(): ...' } }],
    } as unknown as UIMessage;
    const dbMessages = [
      bigMsg('m1', 'user', 2000), toolMsgM2,
      bigMsg('m3', 'user', 200), bigMsg('m4', 'assistant', 200),
    ];
    const { store, saved } = storeWithMessages(existing, dbMessages);
    const result = await selfHealOrphanedCheckpoint(dbMessages as unknown as import("ai").ModelMessage[], {
      conversationId: 'c1', dataStore: store, model: mockModel(VALID_SUMMARY), modelName: 'test-model', contextLimit: 1000,
    });
    expect(saved.length).toBe(1);
    const newSummary = saved[0][1] as string;
    expect(newSummary).toContain('## 行动日志（provenance');
    expect(result.length).toBeLessThan(dbMessages.length);
  });
});
