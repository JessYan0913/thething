import os from 'os';
import path from 'path';
import { describe, it, expect, vi } from 'vitest';
import type { UIMessage } from 'ai';
import {
  getToolOutputConfig,
  getMessageBudgetLimit,
  getPreviewSizeLimit,
  createContentReplacementState,
  type ToolOutputConfig,
} from '../tool-output-manager';
import { persistToolResult, buildPersistedOutputMessage } from '../tool-result-storage';
import { unifiedToolOutputHook } from '../../compaction/unified-output';
import { createSessionState } from '../../session';
import { resolveLayout } from '../../../services/config/layout';
import { createPricingResolver } from '../../../services/model/pricing';
import {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
} from '../../../services/config/defaults';

function createMockDataStore() {
  return {
    costStore: {
      saveCostRecord: vi.fn(),
      getCostRecords: vi.fn().mockResolvedValue([]),
      getTotalCost: vi.fn().mockResolvedValue(0),
    },
    summaryStore: {
      saveSummary: vi.fn(),
      getSummaryByConversation: vi.fn().mockReturnValue(null),
    },
    messageStore: {
      saveMessages: vi.fn(),
      getMessages: vi.fn().mockResolvedValue([]),
    },
    conversationStore: {
      saveConversation: vi.fn(),
      getConversation: vi.fn().mockResolvedValue(null),
      updateConversationTitle: vi.fn(),
    },
  };
}

const layout = resolveLayout({
  resourceRoot: '/tmp/test-project',
  dataDir: '/tmp/test-data',
  configDir: path.join(os.homedir(), '.thething'),
});

describe('tool output config driven behavior', () => {
  it('small session maxResultSizeChars causes persistence', async () => {
    const sessionConfig: ToolOutputConfig = { maxResultSizeChars: 500 };
    const result = await unifiedToolOutputHook('a'.repeat(600), 'bash', 'tool-small-limit', {
      sessionId: 'session-small-limit',
      dataDir: '/tmp/test-data',
      config: sessionConfig,
    });
    expect(result.persisted).toBe(true);
  });

  it('default config leaves small bash output inline', async () => {
    const result = await unifiedToolOutputHook('a'.repeat(600), 'bash', 'tool-default-limit', {
      sessionId: 'session-default-limit',
      dataDir: '/tmp/test-data',
    });
    expect(result.persisted).toBe(false);
    expect(result.content.length).toBe(600);
  });

  it('previewSizeChars controls persisted preview size', async () => {
    const sessionConfig: ToolOutputConfig = { maxResultSizeChars: 1_000, previewSizeChars: 500 };
    const persisted = await persistToolResult(
      'a'.repeat(10_000),
      'tool-preview',
      'session-preview',
      '/tmp/test-data',
      sessionConfig,
    );

    expect(persisted.preview.length).toBeLessThanOrEqual(500);
    expect(getPreviewSizeLimit(sessionConfig)).toBe(500);
    expect(getPreviewSizeLimit()).toBe(PREVIEW_SIZE_CHARS);
    expect(buildPersistedOutputMessage(persisted, false, sessionConfig)).toContain('Preview (first 500B)');
  });

  it('different SessionState instances keep isolated toolOutputConfig snapshots', () => {
    const state1 = createSessionState('session-1', {
      layout,
      projectRoot: layout.resourceRoot,
      toolOutputConfig: { maxResultSizeChars: 10_000, messageBudget: 30_000 },
      dataStore: createMockDataStore() as any,
      pricingResolver: createPricingResolver(),
    });
    const state2 = createSessionState('session-2', {
      layout,
      projectRoot: layout.resourceRoot,
      toolOutputConfig: { maxResultSizeChars: 100_000, previewSizeChars: 500, messageBudget: 80_000 },
      dataStore: createMockDataStore() as any,
      pricingResolver: createPricingResolver(),
    });

    expect(state1.toolOutputConfig).toEqual({ maxResultSizeChars: 10_000, messageBudget: 30_000 });
    expect(state2.toolOutputConfig).toEqual({ maxResultSizeChars: 100_000, previewSizeChars: 500, messageBudget: 80_000 });
    expect(getToolOutputConfig('bash', state1.toolOutputConfig).maxResultSizeChars).toBe(10_000);
    expect(getToolOutputConfig('bash', state2.toolOutputConfig).maxResultSizeChars).toBe(100_000);
  });

  it('defaults stay stable when no session config is provided', () => {
    expect(getToolOutputConfig('default').maxResultSizeChars).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS);
    expect(getMessageBudgetLimit()).toBe(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS);
    expect(getPreviewSizeLimit()).toBe(PREVIEW_SIZE_CHARS);
  });
});
