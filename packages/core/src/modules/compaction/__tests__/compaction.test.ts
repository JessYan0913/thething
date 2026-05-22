import { describe, it, expect, beforeAll } from 'vitest';
import type { UIMessage } from 'ai';
import {
  estimateTextTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  extractMessageText,
  hasTextBlocks,
  stripImagesFromMessages,
} from '../token-counter';
import {
  manageToolOutputLifecycle,
  extractToolMeta,
} from '../lifecycle';
import {
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_LIFECYCLE_CONFIG,
  type LifecycleConfig,
  type CompactedToolResult,
} from '../types';

// ============================================================
// Token Counter Tests
// ============================================================
describe('token-counter', () => {
  it('should estimate text tokens', async () => {
    const tokens = await estimateTextTokens('Hello world');
    expect(tokens).toBeGreaterThan(0);
  });

  it('should estimate message tokens', async () => {
    const msg: UIMessage = {
      id: '1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    };
    const tokens = await estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should extract message text', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello world' }],
    };
    expect(extractMessageText(msg)).toBe('Hello world');
  });

  it('should detect text blocks', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    };
    expect(hasTextBlocks(msg)).toBe(true);
  });

  it('should strip images', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'user',
      parts: [
        { type: 'text', text: 'Hello' },
        { type: 'file', mimeType: 'image/png', data: 'base64data' } as any,
      ],
    };
    const stripped = stripImagesFromMessages([msg]);
    expect(stripped[0].parts).toHaveLength(2);
    expect((stripped[0].parts[1] as any).type).toBe('text');
    expect((stripped[0].parts[1] as any).text).toBe('[image]');
  });
});

// ============================================================
// Lifecycle (Layer 2) Tests
// ============================================================
describe('manageToolOutputLifecycle', () => {
  function createToolMessage(toolName: string, output: unknown, toolCallId = 'tc-1'): UIMessage {
    return {
      id: `msg-${toolCallId}`,
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName,
          toolCallId,
          input: {},
          output,
        } as any,
      ],
    };
  }

  function createUserMessage(text: string): UIMessage {
    return {
      id: `msg-${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text }],
    };
  }

  it('should compress old tool outputs beyond keepRecentTurns', () => {
    const largeOutput = 'x'.repeat(10000);
    const messages = [
      createUserMessage('First question'),
      createToolMessage('Read', { content: largeOutput }, 'tc-1'),
      createUserMessage('Second question'),
      createToolMessage('Bash', { stdout: largeOutput }, 'tc-2'),
      createUserMessage('Third question'),
      createToolMessage('Grep', { matches: [{ file: 'a.ts' }] }, 'tc-3'),
      createUserMessage('Fourth question'),
    ];

    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentTurns: 2 });

    // First two tool outputs should be compressed
    const msg1 = result.messages[1];
    const part1 = msg1.parts[0] as any;
    expect(part1.output._compacted).toBe(true);
    expect(part1.output.summary).toContain('Read');

    const msg3 = result.messages[3];
    const part3 = msg3.parts[0] as any;
    expect(part3.output._compacted).toBe(true);
    expect(part3.output.summary).toContain('Bash');

    // Last tool output should NOT be compressed (within keepRecentTurns)
    const msg5 = result.messages[5];
    const part5 = msg5.parts[0] as any;
    expect(part5.output._compacted).toBeUndefined();
  });

  it('should compress large outputs even within keepRecentTurns', () => {
    const hugeOutput = 'x'.repeat(20000);
    const messages = [
      createUserMessage('Question'),
      createToolMessage('Read', { content: hugeOutput }),
    ];

    const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);

    const part = result.messages[1].parts[0] as any;
    expect(part.output._compacted).toBe(true);
    expect(part.output._originalSize).toBeGreaterThan(0);
  });

  it('should skip already compacted messages', () => {
    const messages = [
      createUserMessage('Question'),
      {
        id: 'msg-1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'Read',
            toolCallId: 'tc-1',
            input: {},
            output: {
              summary: 'Read file.ts → 100 lines',
              _compacted: true,
              _originalSize: 5000,
            } as CompactedToolResult,
          },
        ],
      } as UIMessage,
    ];

    const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);
    expect(result.tokensFreed).toBe(0);
  });

  it('should respect protectedTools', () => {
    const messages = [
      createUserMessage('Question'),
      createToolMessage('MyProtectedTool', { data: 'x'.repeat(10000) }),
    ];

    const config: LifecycleConfig = {
      ...DEFAULT_LIFECYCLE_CONFIG,
      keepRecentTurns: 0,
      protectedTools: new Set(['MyProtectedTool']),
    };

    const result = manageToolOutputLifecycle(messages, config);
    const part = result.messages[1].parts[0] as any;
    expect(part.output._compacted).toBeUndefined();
  });

  it('should handle mcp_ prefixed tools', () => {
    const messages = [
      createUserMessage('Question'),
      createToolMessage('mcp_myserver', { result: 'x'.repeat(10000) }),
    ];

    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentTurns: 0 });
    const part = result.messages[1].parts[0] as any;
    expect(part.output._compacted).toBe(true);
  });
});

// ============================================================
// Tool Meta Extractors Tests
// ============================================================
describe('extractToolMeta', () => {
  it('should extract Read metadata', () => {
    const meta = extractToolMeta('Read', { file_path: '/src/index.ts' }, { content: 'line1\nline2\nline3' });
    expect(meta).toContain('Read');
    expect(meta).toContain('/src/index.ts');
    expect(meta).toContain('3 lines');
  });

  it('should extract Bash metadata', () => {
    const meta = extractToolMeta('Bash', { command: 'ls -la' }, { stdout: 'file1\nfile2', exitCode: 0 });
    expect(meta).toContain('Bash');
    expect(meta).toContain('ls -la');
    expect(meta).toContain('exit 0');
  });

  it('should extract Grep metadata', () => {
    const meta = extractToolMeta('Grep', { pattern: 'TODO' }, { matches: [{ file: 'a.ts' }, { file: 'b.ts' }] });
    expect(meta).toContain('Grep');
    expect(meta).toContain('TODO');
    expect(meta).toContain('2 matches');
  });

  it('should use default extractor for unknown tools', () => {
    const meta = extractToolMeta('CustomTool', {}, { someKey: 'value' });
    expect(meta).toContain('CustomTool');
  });

  it('should handle string results in default extractor', () => {
    const meta = extractToolMeta('CustomTool', {}, 'short result');
    // extractToolMeta wraps with toolName prefix
    expect(meta).toBe('CustomTool: short result');
  });
});
