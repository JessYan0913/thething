import { describe, it, expect, vi } from 'vitest';
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
