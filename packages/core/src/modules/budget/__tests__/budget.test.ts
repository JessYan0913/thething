import path from 'path';
import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import {
  TOOL_OUTPUT_CONFIGS,
  getToolOutputConfig,
  matchesToolPrefix,
  getMessageBudgetLimit,
  getPreviewSizeLimit,
  createContentReplacementState,
  cloneContentReplacementState,
  estimateContentTokens,
  estimateObjectTokens,
  calculateOutputSize,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
  PERSISTED_OUTPUT_TAG,
  PERSISTED_OUTPUT_CLOSING_TAG,
  TOOL_RESULT_CLEARED_MESSAGE,
  type ToolOutputConfig,
} from '../tool-output-manager';
import {
  getToolResultsDir,
  getToolResultPath,
  generatePreview,
  buildPersistedOutputMessage,
  formatSize,
  TOOL_RESULTS_SUBDIR,
} from '../tool-result-storage';
import { unifiedToolOutputHook } from '../../compaction/unified-output';

describe('tool-output-manager', () => {
  it('keeps exact/default/prefix tool configs', () => {
    expect(TOOL_OUTPUT_CONFIGS.bash.maxResultSizeChars).toBe(100_000);
    expect(matchesToolPrefix('mcp_custom_tool')).toBe('mcp');
    expect(matchesToolPrefix('connector_sql')).toBe('connector');
    expect(getToolOutputConfig('unknown_tool').maxResultSizeChars).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS);
  });

  it('applies session-level tool output overrides with the new ToolOutputConfig shape', () => {
    const sessionConfig: ToolOutputConfig = {
      maxResultSizeChars: 12_345,
      maxResultTokens: 10,
      messageBudget: 50_000,
      previewSizeChars: 512,
    };

    expect(getToolOutputConfig('bash', sessionConfig).maxResultSizeChars).toBe(12_345);
    expect(getMessageBudgetLimit(sessionConfig)).toBe(50_000);
    expect(getPreviewSizeLimit(sessionConfig)).toBe(512);
    expect(getMessageBudgetLimit()).toBe(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS);
    expect(getPreviewSizeLimit()).toBe(PREVIEW_SIZE_CHARS);
  });

  it('tracks content replacement state independently per clone', () => {
    const original = createContentReplacementState();
    original.seenIds.add('tool-1');
    original.replacements.set('tool-1', 'preview-1');

    const cloned = cloneContentReplacementState(original);
    cloned.seenIds.add('tool-2');

    expect(original.seenIds.has('tool-2')).toBe(false);
    expect(cloned.replacements.get('tool-1')).toBe('preview-1');
  });

  it('estimates content and output sizes', () => {
    // 系数统一后拉丁文本按 4 字符/token 估算(35/4 → 9)
    expect(estimateContentTokens('a'.repeat(36))).toBe(9);
    expect(estimateObjectTokens({ key: 'value' })).toBeGreaterThan(0);
    expect(calculateOutputSize('hello')).toBe(5);
    expect(calculateOutputSize({ key: 'value' })).toBe(JSON.stringify({ key: 'value' }).length);
  });

  it('returns inline output under the limit and persists output over the limit', async () => {
    const small = await unifiedToolOutputHook('small content', 'bash', 'tool-small');
    expect(small.persisted).toBe(false);
    expect(small.content).toBe('small content');

    const large = await unifiedToolOutputHook('a'.repeat(150_000), 'bash', 'tool-large', {
      sessionId: 'session-1',
      dataDir: '/tmp/thething-data',
    });
    expect(large.persisted).toBe(true);
    expect(large.content).toContain(PERSISTED_OUTPUT_TAG);
    expect(large.content).toContain(PERSISTED_OUTPUT_CLOSING_TAG);
  });

  it('exports stable persisted-output markers', () => {
    expect(PERSISTED_OUTPUT_TAG).toBe('<persisted-output>');
    expect(PERSISTED_OUTPUT_CLOSING_TAG).toBe('</persisted-output>');
    expect(TOOL_RESULT_CLEARED_MESSAGE).toBe('[Old tool result content cleared]');
  });
});

describe('tool-result-storage', () => {
  it('builds paths from dataDir instead of projectDir', () => {
    const dir = getToolResultsDir('session-1', '/var/lib/thething/data');
    const file = getToolResultPath('tool-1', 'session-1', '/var/lib/thething/data');

    expect(dir).toBe(path.join('/var/lib/thething/data', TOOL_RESULTS_SUBDIR, 'session-1'));
    expect(file).toBe(path.join('/var/lib/thething/data', TOOL_RESULTS_SUBDIR, 'session-1', 'tool-1.txt'));
    expect(dir).not.toContain('.thething');
  });

  it('generates previews and persisted output messages with session config', () => {
    const preview = generatePreview('a'.repeat(10_000), 500);
    expect(preview.preview.length).toBeLessThanOrEqual(500);
    expect(preview.hasMore).toBe(true);

    const message = buildPersistedOutputMessage({
      filepath: '/tmp/result.txt',
      originalSize: 10_000,
      preview: 'preview',
      hasMore: true,
    }, false, { maxResultSizeChars: 1_000, previewSizeChars: 500 });
    expect(message).toContain('/tmp/result.txt');
    expect(message).toContain('Preview (first 500B)');
    expect(formatSize(2_000)).toBe('2.0KB');
  });
});

