import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { UIMessage } from 'ai';
import {
  TOOL_OUTPUT_CONFIGS,
  getToolOutputConfig,
  matchesToolPrefix,
  setToolOutputOverrides,
  getToolOutputOverrides,
  getMessageBudgetLimit,
  createContentReplacementState,
  cloneContentReplacementState,
  estimateContentTokens,
  estimateObjectTokens,
  calculateOutputSize,
  processToolOutput,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PERSISTED_OUTPUT_TAG,
  PERSISTED_OUTPUT_CLOSING_TAG,
  TOOL_RESULT_CLEARED_MESSAGE,
  type ToolOutputConfig,
  type ContentReplacementState,
} from '../tool-output-manager';
import {
  getToolResultsDir,
  getToolResultPath,
  generatePreview,
  buildPersistedOutputMessage,
  formatSize,
  TOOL_RESULTS_SUBDIR,
  type PersistedToolResult,
} from '../tool-result-storage';
import {
  enforceToolResultBudget,
  estimateToolResultsTotal,
  buildToolNameMap,
  type BudgetCheckResult,
} from '../message-budget';

// ============================================================
// Tool Output Manager Tests
// ============================================================
describe('tool-output-manager', () => {
  describe('TOOL_OUTPUT_CONFIGS', () => {
    it('should have config for bash tool', () => {
      expect(TOOL_OUTPUT_CONFIGS['bash']).toBeDefined();
      expect(TOOL_OUTPUT_CONFIGS['bash'].maxResultSizeChars).toBe(100_000);
      // shouldPersistToDisk 现是可选字段，默认 true
    });

    it('should have config for read_file tool', () => {
      expect(TOOL_OUTPUT_CONFIGS['read_file']).toBeDefined();
      expect(TOOL_OUTPUT_CONFIGS['read_file'].maxResultSizeChars).toBe(50_000);
    });

    it('should have config for grep tool', () => {
      expect(TOOL_OUTPUT_CONFIGS['grep']).toBeDefined();
      expect(TOOL_OUTPUT_CONFIGS['grep'].maxResultSizeChars).toBe(30_000);
    });

    it('should have default configs for mcp and connector', () => {
      expect(TOOL_OUTPUT_CONFIGS['mcp_default']).toBeDefined();
      expect(TOOL_OUTPUT_CONFIGS['connector_default']).toBeDefined();
    });

    it('should have default config', () => {
      expect(TOOL_OUTPUT_CONFIGS['default']).toBeDefined();
      expect(TOOL_OUTPUT_CONFIGS['default'].maxResultSizeChars).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS);
    });

    // ✅ 改进：移除 truncationMessage 测试，因为该字段已移除
    // 所有工具的大输出现在都持久化而非截断
  });

  describe('matchesToolPrefix', () => {
    it('should match mcp prefix', () => {
      expect(matchesToolPrefix('mcp_server_tool')).toBe('mcp');
      expect(matchesToolPrefix('mcp_anything')).toBe('mcp');
    });

    it('should match connector prefix', () => {
      expect(matchesToolPrefix('connector_sql')).toBe('connector');
      expect(matchesToolPrefix('connector_http')).toBe('connector');
    });

    it('should return null for non-matching tools', () => {
      expect(matchesToolPrefix('bash')).toBeNull();
      expect(matchesToolPrefix('read_file')).toBeNull();
      expect(matchesToolPrefix('unknown_tool')).toBeNull();
    });
  });

  describe('getToolOutputConfig', () => {
    it('should return exact match config', () => {
      const config = getToolOutputConfig('bash');
      expect(config.maxResultSizeChars).toBe(100_000);
    });

    it('should return mcp_default for mcp_ prefixed tools', () => {
      const config = getToolOutputConfig('mcp_custom_tool');
      expect(config.maxResultSizeChars).toBe(100_000);
      // truncationMessage 已移除
    });

    it('should return connector_default for connector_ prefixed tools', () => {
      const config = getToolOutputConfig('connector_api');
      expect(config.maxResultSizeChars).toBe(50_000);
      // truncationMessage 已移除
    });

    it('should return default config for unknown tools', () => {
      const config = getToolOutputConfig('unknown_tool');
      expect(config.maxResultSizeChars).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS);
    });

    it('should apply threshold override', () => {
      setToolOutputOverrides({ thresholds: { bash: 50_000 } });
      const config = getToolOutputConfig('bash');
      expect(config.maxResultSizeChars).toBe(50_000);
      // Reset
      setToolOutputOverrides({});
    });

    it('should not apply override for tools not in thresholds', () => {
      setToolOutputOverrides({ thresholds: { read_file: 10_000 } });
      const config = getToolOutputConfig('bash');
      expect(config.maxResultSizeChars).toBe(100_000);
      setToolOutputOverrides({});
    });
  });

  describe('ToolOutputOverrides', () => {
    beforeEach(() => {
      setToolOutputOverrides({});
    });

    afterEach(() => {
      setToolOutputOverrides({});
    });

    it('should set and get overrides', () => {
      const overrides = { thresholds: { bash: 50_000 }, messageBudget: 100_000 };
      setToolOutputOverrides(overrides);
      expect(getToolOutputOverrides()).toEqual(overrides);
    });

    it('should clear overrides when set to empty', () => {
      setToolOutputOverrides({ thresholds: { bash: 50_000 } });
      setToolOutputOverrides({});
      expect(getToolOutputOverrides()).toEqual({});
    });
  });

  describe('getMessageBudgetLimit', () => {
    beforeEach(() => {
      setToolOutputOverrides({});
    });

    afterEach(() => {
      setToolOutputOverrides({});
    });

    it('should return default limit without override', () => {
      expect(getMessageBudgetLimit()).toBe(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS);
    });

    it('should return override limit when set', () => {
      setToolOutputOverrides({ messageBudget: 50_000 });
      expect(getMessageBudgetLimit()).toBe(50_000);
    });

    it('should return default when override is invalid', () => {
      setToolOutputOverrides({ messageBudget: 0 });
      expect(getMessageBudgetLimit()).toBe(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS);
      setToolOutputOverrides({ messageBudget: -100 });
      expect(getMessageBudgetLimit()).toBe(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS);
    });
  });

  describe('ContentReplacementState', () => {
    it('should create empty state', () => {
      const state = createContentReplacementState();
      expect(state.seenIds.size).toBe(0);
      expect(state.replacements.size).toBe(0);
    });

    it('should clone state correctly', () => {
      const original = createContentReplacementState();
      original.seenIds.add('tool-1');
      original.seenIds.add('tool-2');
      original.replacements.set('tool-1', 'preview-1');

      const cloned = cloneContentReplacementState(original);
      expect(cloned.seenIds.size).toBe(2);
      expect(cloned.seenIds.has('tool-1')).toBe(true);
      expect(cloned.replacements.size).toBe(1);
      expect(cloned.replacements.get('tool-1')).toBe('preview-1');

      // Verify independence
      cloned.seenIds.add('tool-3');
      expect(original.seenIds.has('tool-3')).toBe(false);
    });
  });

  describe('estimateContentTokens', () => {
    it('should estimate tokens based on 3.5 chars per token', () => {
      expect(estimateContentTokens('a'.repeat(35))).toBe(10);
      expect(estimateContentTokens('a'.repeat(7))).toBe(2);
    });

    it('should ceil the result', () => {
      expect(estimateContentTokens('hello')).toBe(2); // 5/3.5 ≈ 1.43, ceil = 2
    });

    it('should return 0 for empty string', () => {
      expect(estimateContentTokens('')).toBe(0);
    });
  });

  describe('estimateObjectTokens', () => {
    it('should estimate tokens for simple object', () => {
      const obj = { key: 'value' };
      const tokens = estimateObjectTokens(obj);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens for nested object', () => {
      const obj = { nested: { deep: { value: 'test' } } };
      const tokens = estimateObjectTokens(obj);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle arrays', () => {
      const arr = [1, 2, 3, 4, 5];
      const tokens = estimateObjectTokens(arr);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('calculateOutputSize', () => {
    it('should return string length for string output', () => {
      expect(calculateOutputSize('hello')).toBe(5);
      expect(calculateOutputSize('a'.repeat(1000))).toBe(1000);
    });

    it('should return JSON length for object output', () => {
      const obj = { key: 'value' };
      const size = calculateOutputSize(obj);
      expect(size).toBe(JSON.stringify(obj).length);
    });

    it('should return 0 for null/undefined', () => {
      expect(calculateOutputSize(null)).toBe(0);
      expect(calculateOutputSize(undefined)).toBe(0);
    });

    it('should return 0 for non-stringifiable objects', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(calculateOutputSize(circular)).toBe(0);
    });
  });

  describe('processToolOutput', () => {
    beforeEach(() => {
      setToolOutputOverrides({});
    });

    afterEach(() => {
      setToolOutputOverrides({});
    });

    it('should return original content when under limit', async () => {
      const smallContent = 'small content';
      const result = await processToolOutput(smallContent, 'bash', 'tool-1');
      expect(result.content).toBe(smallContent);
      expect(result.persisted).toBe(false);
      expect(result.originalSize).toBe(smallContent.length);
    });

    // ✅ 改进：现在始终持久化，不再截断
    it('should persist when over limit (even without sessionContext)', async () => {
      const largeContent = 'a'.repeat(150_000);
      const result = await processToolOutput(largeContent, 'bash', 'tool-1');
      expect(result.persisted).toBe(true);
      expect(result.content).toContain(PERSISTED_OUTPUT_TAG);
      expect(result.content).toContain('Preview');
      expect(result.filepath).toBeDefined();
    });

    it('should persist with sessionContext when over limit', async () => {
      const largeContent = 'a'.repeat(150_000);
      const state = createContentReplacementState();
      const result = await processToolOutput(largeContent, 'bash', 'tool-1', {
        sessionId: 'test-session',
        projectDir: '/tmp',
        state,
      });
      expect(result.persisted).toBe(true);
      expect(result.content).toContain(PERSISTED_OUTPUT_TAG);
      expect(result.filepath).toBeDefined();
      expect(state.seenIds.has('tool-1')).toBe(true);
    });

    it('should add to seenIds when state provided', async () => {
      const state = createContentReplacementState();
      const content = 'test content';
      await processToolOutput(content, 'bash', 'tool-1', { state });
      expect(state.seenIds.has('tool-1')).toBe(true);
    });

    it('should handle object output', async () => {
      const obj = { result: 'test' };
      const result = await processToolOutput(obj, 'bash', 'tool-1');
      expect(result.content).toContain('result');
      expect(result.originalSize).toBeGreaterThan(0);
    });
  });

  describe('constants', () => {
    it('should have correct PERSISTED_OUTPUT_TAG', () => {
      expect(PERSISTED_OUTPUT_TAG).toBe('<persisted-output>');
    });

    it('should have correct PERSISTED_OUTPUT_CLOSING_TAG', () => {
      expect(PERSISTED_OUTPUT_CLOSING_TAG).toBe('</persisted-output>');
    });

    it('should have correct TOOL_RESULT_CLEARED_MESSAGE', () => {
      expect(TOOL_RESULT_CLEARED_MESSAGE).toBe('[Old tool result content cleared]');
    });
  });
});

// ============================================================
// Tool Result Storage Tests
// ============================================================
describe('tool-result-storage', () => {
  describe('path functions', () => {
    it('should build correct tool results directory', () => {
      const dir = getToolResultsDir('session-1', '/project');
      expect(dir).toContain('.thething');
      expect(dir).toContain(TOOL_RESULTS_SUBDIR);
      expect(dir).toContain('session-1');
    });

    it('should build correct tool result path', () => {
      const path = getToolResultPath('tool-1', 'session-1', '/project');
      expect(path).toContain('tool-1');
      expect(path).toMatch(/\.txt$/);
    });

    it('should build json path when isJson is true', () => {
      const path = getToolResultPath('tool-1', 'session-1', '/project', true);
      expect(path).toMatch(/\.json$/);
    });
  });

  describe('generatePreview', () => {
    it('should return full content when under limit', () => {
      const content = 'small content';
      const result = generatePreview(content, 2000);
      expect(result.preview).toBe(content);
      expect(result.hasMore).toBe(false);
    });

    it('should truncate at last newline in truncated portion when > 50% of limit', () => {
      // Create content where the last newline within first 2000 chars is at position > 50%
      // 1500 b's + '\n' + 500 more chars (all without newline) + more content beyond 2000
      const line1 = 'b'.repeat(1500);
      const rest = 'a'.repeat(500); // No newlines here
      const content = line1 + '\n' + rest + 'c'.repeat(2000); // Total > 2000
      const result = generatePreview(content, 2000);
      expect(result.hasMore).toBe(true);
      // The truncated portion (2000 chars) is: 1500 b's + '\n' + 499 a's
      // lastNewline is at position 1500, which > 1000 (50% of 2000)
      // So preview is content.slice(0, 1500) = the 1500 b's
      expect(result.preview).toBe(line1);
    });

    it('should truncate at max chars when newline < 50% of limit', () => {
      // Create content where newline appears at position < 50% of limit
      const content = 'line1\nline2\nline3\n' + 'a'.repeat(3000);
      const result = generatePreview(content, 2000);
      expect(result.hasMore).toBe(true);
      // Newline at 18 < 1000 (50% of 2000), so truncate at maxChars
      expect(result.preview.length).toBe(2000);
      // Since truncation is at maxChars, the preview includes part of line3
      expect(result.preview).toContain('line3');
    });

    it('should truncate at max chars when no newline near limit', () => {
      const content = 'a'.repeat(5000);
      const result = generatePreview(content, 2000);
      expect(result.preview.length).toBe(2000);
      expect(result.hasMore).toBe(true);
    });

    it('should handle empty content', () => {
      const result = generatePreview('', 2000);
      expect(result.preview).toBe('');
      expect(result.hasMore).toBe(false);
    });

    it('should use newline position when over 50% of limit', () => {
      // Create content with newline at 60% of limit, and content > limit
      const line1 = 'a'.repeat(1200); // 60% of 2000
      const content = line1 + '\n' + 'b'.repeat(2000); // Total > 2000 chars
      const result = generatePreview(content, 2000);
      // Newline at 1200 > 1000 (50% of 2000), so should truncate at newline
      expect(result.preview).toBe(line1);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('buildPersistedOutputMessage', () => {
    it('should build message with all required parts', () => {
      const result: PersistedToolResult = {
        filepath: '/path/to/file.txt',
        originalSize: 50000,
        preview: 'preview content',
        hasMore: true,
      };
      const message = buildPersistedOutputMessage(result);
      expect(message).toContain(PERSISTED_OUTPUT_TAG);
      expect(message).toContain(PERSISTED_OUTPUT_CLOSING_TAG);
      expect(message).toContain('/path/to/file.txt');
      expect(message).toContain('preview content');
      expect(message).toContain('...');
      // ✅ 改进：检查新格式中包含"可读取完整内容"提示
      expect(message).toContain('read_file');
    });

    it('should not include ... when hasMore is false', () => {
      const result: PersistedToolResult = {
        filepath: '/path/to/file.txt',
        originalSize: 100,
        preview: 'preview',
        hasMore: false,
      };
      const message = buildPersistedOutputMessage(result);
      expect(message).not.toContain('...');
    });

    it('should include formatted size', () => {
      const result: PersistedToolResult = {
        filepath: '/path',
        originalSize: 50000,
        preview: 'preview',
        hasMore: false,
      };
      const message = buildPersistedOutputMessage(result);
      expect(message).toContain('KB');
    });

    // ✅ 新增：测试临时持久化消息
    it('should include temporary note for isTemporary=true', () => {
      const result: PersistedToolResult = {
        filepath: '/path/to/file.txt',
        originalSize: 50000,
        preview: 'preview',
        hasMore: true,
      };
      const message = buildPersistedOutputMessage(result, true);
      expect(message).toContain('temporary');
      expect(message).toContain('Copy');
    });
  });

  describe('formatSize', () => {
    it('should format bytes under 1KB', () => {
      expect(formatSize(500)).toBe('500B');
      expect(formatSize(0)).toBe('0B');
    });

    it('should format KB under 1MB', () => {
      expect(formatSize(1024)).toBe('1.0KB');
      expect(formatSize(2048)).toBe('2.0KB');
      expect(formatSize(1536)).toBe('1.5KB');
    });

    it('should format MB', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0MB');
      expect(formatSize(1024 * 1024 * 2.5)).toBe('2.5MB');
    });
  });
});

// ============================================================
// Message Budget Tests
// ============================================================
describe('message-budget', () => {
  describe('estimateToolResultsTotal', () => {
    it('should return 0 for messages without tool results', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
      ];
      const result = estimateToolResultsTotal(messages);
      expect(result.totalChars).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.isOverBudget).toBe(false);
    });

    it('should estimate tool result size', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        {
          id: '2',
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              tool_use_id: 'tool-1',
              content: 'a'.repeat(50000),
            } as any,
          ],
        },
      ];
      const result = estimateToolResultsTotal(messages);
      expect(result.totalChars).toBe(50000);
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    it('should calculate percentUsed', () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              tool_use_id: 'tool-1',
              content: 'a'.repeat(100000),
            } as any,
          ],
        },
      ];
      const result = estimateToolResultsTotal(messages);
      expect(result.percentUsed).toBeGreaterThan(0);
      expect(result.percentUsed).toBeLessThanOrEqual(100);
    });

    it('should detect over budget', () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              tool_use_id: 'tool-1',
              content: 'a'.repeat(300000), // Over default budget (200000)
            } as any,
          ],
        },
      ];
      const result = estimateToolResultsTotal(messages);
      expect(result.isOverBudget).toBe(true);
    });
  });

  describe('buildToolNameMap', () => {
    it('should return empty map for messages without tool uses', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      const map = buildToolNameMap(messages);
      expect(map.size).toBe(0);
    });

    it('should build map from assistant tool-use parts', () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-use',
              id: 'call-1',
              name: 'bash',
            } as any,
            {
              type: 'tool-use',
              id: 'call-2',
              name: 'read_file',
            } as any,
          ],
        },
      ];
      const map = buildToolNameMap(messages);
      expect(map.size).toBe(2);
      expect(map.get('call-1')).toBe('bash');
      expect(map.get('call-2')).toBe('read_file');
    });

    it('should not include non-assistant messages', () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          parts: [
            {
              type: 'tool-use',
              id: 'call-1',
              name: 'bash',
            } as any,
          ],
        },
      ];
      const map = buildToolNameMap(messages);
      expect(map.size).toBe(0);
    });
  });

  describe('enforceToolResultBudget', () => {
    it('should return unchanged messages when under budget', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              tool_use_id: 'tool-1',
              content: 'small result',
            } as any,
          ],
        },
      ];
      const state = createContentReplacementState();
      const result = await enforceToolResultBudget(messages, state, 'session-1', '/tmp');

      expect(result.messages).toEqual(messages);
      expect(result.newlyPersisted.length).toBe(0);
      expect(result.tokensSaved).toBe(0);
    });

    it('should skip seen IDs', async () => {
      const state = createContentReplacementState();
      state.seenIds.add('tool-1');

      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              tool_use_id: 'tool-1',
              content: 'a'.repeat(100000),
            } as any,
          ],
        },
      ];

      const result = await enforceToolResultBudget(messages, state, 'session-1', '/tmp');
      // Should skip because already seen
      expect(result.newlyPersisted.length).toBe(0);
    });

    it('should skip specified tool names', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              tool_use_id: 'tool-1',
              content: 'a'.repeat(300000),
              name: 'important_tool',
            } as any,
          ],
        },
      ];

      const state = createContentReplacementState();
      const skipTools = new Set(['important_tool']);

      const result = await enforceToolResultBudget(messages, state, 'session-1', '/tmp', skipTools);
      expect(result.newlyPersisted.length).toBe(0);
    });

    it('should calculate totalBefore and totalAfter', async () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              tool_use_id: 'tool-1',
              content: 'a'.repeat(50000),
            } as any,
            {
              type: 'tool-result',
              tool_use_id: 'tool-2',
              content: 'b'.repeat(30000),
            } as any,
          ],
        },
      ];

      const state = createContentReplacementState();
      const result = await enforceToolResultBudget(messages, state, 'session-1', '/tmp');

      expect(result.totalBefore).toBe(80000);
      expect(result.totalAfter).toBe(result.totalBefore); // Under budget, no change
    });
  });
});