import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import type { DataStore, StoredSummary } from '../../../primitives/datastore/types';
import { applyCheckpointOnLoad, CHECKPOINT_SUMMARY_ID_PREFIX } from '../checkpoint';

// ============================================================
// 8.5 compaction checkpoint 持久化
// 见 docs/compaction-execution-plan.md 步骤 8.5
// ============================================================

function msg(id: string, text: string): UIMessage {
  return { id, role: 'user', content: [{ type: 'text', text }] } as unknown as UIMessage;
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
    expect((result[0] as any).content[0].text).toContain('previous work summary');
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
