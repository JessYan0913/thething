import { describe, it, expect, vi } from 'vitest';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { UIMessage } from 'ai';
import type { DataStore } from '../../primitives/datastore/types';
import { finalizeAgentRun } from '../finalize';

// ============================================================
// finalizeAgentRun 资源清理测试
//
// 关键回归点：finalize 收到 mcpRegistry: null（共享 registry 传 null）
// 时不得断开任何连接——共享 registry 由 AppContext/syncServers 管理。
// ============================================================

async function flushImmediate(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('finalizeAgentRun', () => {
  it('mcpRegistry: null skips disconnect and still persists cost', async () => {
    const persistToDB = vi.fn().mockResolvedValue(undefined);
    const disconnectAll = vi.fn().mockResolvedValue(undefined);

    await finalizeAgentRun({
      dataStore: {} as never,
      messages: [],
      conversationId: 'conv-1',
      costTracker: {
        persistToDB,
        getSummary: () => ({ totalCostUsd: 0, inputTokens: 0, outputTokens: 0 }),
      },
      mcpRegistry: null, // 共享 registry → 调用方传 null
      model: undefined,
      isNewConversation: false,
    });

    await flushImmediate();
    await flushImmediate();

    expect(persistToDB).toHaveBeenCalledTimes(1);
    expect(disconnectAll).not.toHaveBeenCalled();
  });

  it('non-null mcpRegistry disconnects it (per-request registry cleanup)', async () => {
    const persistToDB = vi.fn().mockResolvedValue(undefined);
    const disconnectAll = vi.fn().mockResolvedValue(undefined);

    await finalizeAgentRun({
      dataStore: {} as never,
      messages: [],
      conversationId: 'conv-2',
      costTracker: {
        persistToDB,
        getSummary: () => ({ totalCostUsd: 0, inputTokens: 0, outputTokens: 0 }),
      },
      mcpRegistry: { disconnectAll } as never,
      model: undefined,
      isNewConversation: false,
    });

    await flushImmediate();
    await flushImmediate();

    expect(disconnectAll).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// checkpoint 同步落库（e3bbd31 回归验证）
//
// 修复前 maybeCheckpointAfterRun 在 setImmediate 后台 fire-and-forget，
// LLM 摘要慢 → 快速连续 run 时下一轮 load-time 拿不到刚生成的摘要 →
// 回退全量历史 → CONTEXT_BUDGET_EXCEEDED。修复后同步 await：finalize
// 返回时摘要已落库，无需 flushImmediate。
// ============================================================

function bigMsg(id: string, size: number): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text: 'x'.repeat(size) }] } as unknown as UIMessage;
}

function mockModel(): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: async () => ({
      content: [{ type: 'text', text: '## 已完成\ncheckpoint sync test' }],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      warnings: [],
    }),
    doStream: async () => { throw new Error('not implemented'); },
  } as unknown as LanguageModelV3;
}

describe('finalizeAgentRun checkpoint 同步', () => {
  it('同步落库：finalize 返回时摘要已在（无需 flushImmediate）', async () => {
    // 超水位线消息：contextLimit 1000 → 水位 500；6 条大消息远超标
    const messages = [bigMsg('m1', 2000), bigMsg('m2', 2000), bigMsg('m3', 2000), bigMsg('m4', 2000), bigMsg('m5', 200), bigMsg('m6', 200)];
    const saved: unknown[][] = [];
    const store = {
      summaryStore: {
        getSummaryByConversation: () => null,
        saveSummary: (...args: unknown[]) => { saved.push(args); return {}; },
      },
      messageStore: {
        getMessagesByConversation: () => messages,
      },
    } as unknown as DataStore;

    await finalizeAgentRun({
      dataStore: store,
      messages,
      conversationId: 'c1',
      costTracker: {
        persistToDB: () => Promise.resolve(),
        getSummary: () => ({ totalCostUsd: 0, inputTokens: 0, outputTokens: 0 }),
      },
      mcpRegistry: null,
      model: mockModel(),
      isNewConversation: false,
      checkpoint: { modelName: 'test-model', contextLimit: 1000 },
    });

    // 关键断言：同步路径，finalize await 返回后 checkpoint 已落库
    expect(saved.length).toBe(1);
    // 摘要含模型输出，锚点落在消息 id 上
    expect(saved[0][1]).toContain('checkpoint sync test');
    expect(['m1', 'm2', 'm3', 'm4']).toContain(saved[0][4]);
  });

  it('checkpoint 失败不阻断收尾（catch 返回，不 throw）', async () => {
    const messages = [bigMsg('m1', 2000), bigMsg('m2', 2000), bigMsg('m3', 2000), bigMsg('m4', 2000)];
    const store = {
      summaryStore: {
        getSummaryByConversation: () => { throw new Error('db down'); },
      },
      messageStore: {
        getMessagesByConversation: () => messages,
      },
    } as unknown as DataStore;

    await expect(finalizeAgentRun({
      dataStore: store,
      messages,
      conversationId: 'c2',
      costTracker: {
        persistToDB: () => Promise.resolve(),
        getSummary: () => ({ totalCostUsd: 0, inputTokens: 0, outputTokens: 0 }),
      },
      mcpRegistry: null,
      model: mockModel(),
      isNewConversation: false,
      checkpoint: { modelName: 'test-model', contextLimit: 1000 },
    })).resolves.toBeUndefined();
  });
});
