import { describe, it, expect, beforeAll } from 'vitest';
import type { ModelMessage } from 'ai';
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
    const msg = { role: 'user', parts: [{ type: 'text', text: 'Hello' }] } as unknown as ModelMessage;
    const tokens = await estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should count ModelMessage text content (not just tool-result)', async () => {
    // 修复前:ModelMessage 的 content 数组中只统计 tool-result,text 和 tool-call input 被忽略
    // 修复后:assistant 长回复的实际文本内容也应计入
    const longText = 'x'.repeat(5000);
    const msgWithText = {
      role: 'assistant',
      content: [{ type: 'text', text: longText }],
    } as unknown as ModelMessage;
    const tokensWithText = await estimateMessageTokens(msgWithText);

    const msgWithoutText = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
    } as unknown as ModelMessage;
    const tokensWithoutText = await estimateMessageTokens(msgWithoutText);

    // 有长文本的消息 token 应显著高于空文本
    expect(tokensWithText).toBeGreaterThan(tokensWithoutText + 100);
  });

  it('should count ModelMessage tool-call input', async () => {
    const msgWithToolCall = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me search' },
        { type: 'tool-call', toolCallId: 'tc-1', toolName: 'grep', args: { pattern: 'extractToolMeta', path: '/repo/src' } },
      ],
    } as unknown as ModelMessage;
    const msgWithoutToolCall = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Let me search' }],
    } as unknown as ModelMessage;

    const tokensWith = await estimateMessageTokens(msgWithToolCall);
    const tokensWithout = await estimateMessageTokens(msgWithoutToolCall);

    // tool-call 的 args 应被计入
    expect(tokensWith).toBeGreaterThan(tokensWithout);
  });

  it('should extract message text', () => {
    const msg = { role: 'user', parts: [{ type: 'text', text: 'Hello world' }] } as unknown as ModelMessage;
    expect(extractMessageText(msg)).toBe('Hello world');
  });

  it('should detect text blocks', () => {
    const msg = { role: 'user', parts: [{ type: 'text', text: 'Hello' }] } as unknown as ModelMessage;
    expect(hasTextBlocks(msg)).toBe(true);
  });

  it('should strip images', () => {
    const msg = { role: 'user', parts: [
        { type: 'text', text: 'Hello' },
        { type: 'file', mimeType: 'image/png', data: 'base64data' } as any,
      ]} as unknown as ModelMessage;
    const stripped = stripImagesFromMessages([msg]);
    expect((stripped[0] as unknown as { parts: any[] }).parts).toHaveLength(2);
    expect(((stripped[0] as unknown as { parts: any[] }).parts[1] as any).type).toBe('text');
    expect(((stripped[0] as unknown as { parts: any[] }).parts[1] as any).text).toBe('[image]');
  });
});

// ============================================================
// Lifecycle (Layer 2) Tests
// ============================================================
// 流水线传递的是 ModelMessage 格式:工具结果在 .content 数组中,
// 类型为 tool-result,output 为 ToolResultOutput({type, value})。
describe('manageToolOutputLifecycle', () => {
  function createToolMessage(toolName: string, output: unknown, toolCallId?: string): ModelMessage {
    return {
      id: `msg-${toolCallId}`,
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName,
          toolCallId,
          output: { type: 'json', value: output },
        },
      ],
    } as unknown as ModelMessage;
  }

  function createUserMessage(text: string): ModelMessage {
    return {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text }],
    } as unknown as ModelMessage;
  }

  function getResultItem(msg: ModelMessage): any {
    return ((msg as unknown as Record<string, unknown>).content as any[])[0];
  }

  it('should compress old tool outputs beyond keepRecentSteps', () => {
    const largeOutput = 'x'.repeat(10000);
    const messages = [
      createUserMessage('First question'),
      createToolMessage('read_file', { path: 'src/a.ts', content: largeOutput }, 'tc-1'),
      createUserMessage('Second question'),
      createToolMessage('bash', { command: 'npm test', stdout: largeOutput, exitCode: 0 }, 'tc-2'),
      createUserMessage('Third question'),
      createToolMessage('grep', JSON.stringify({ pattern: 'foo', matches: [{ file: 'a.ts' }] }), 'tc-3'),
      createUserMessage('Fourth question'),
    ];

    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 2 });

    // First two tool outputs should be compressed
    const item1 = getResultItem(result.messages[1] as ModelMessage);
    expect(item1._compacted).toBe(true);
    expect(item1.output.value).toContain('Read');

    const item3 = getResultItem(result.messages[3] as ModelMessage);
    expect(item3._compacted).toBe(true);
    expect(item3.output.value).toContain('Bash');

    // Last tool output should NOT be compressed (within keepRecentSteps)
    const item5 = getResultItem(result.messages[5] as ModelMessage);
    expect(item5._compacted).toBeUndefined();
  });

  it('should compress large outputs even within keepRecentSteps', () => {
    const hugeOutput = 'x'.repeat(20000);
    const messages = [
      createUserMessage('Question'),
      createToolMessage('read_file', { path: 'src/a.ts', content: hugeOutput }),
    ];

    const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);

    const item = getResultItem(result.messages[1] as ModelMessage);
    expect(item._compacted).toBe(true);
    expect(item._originalSize).toBeGreaterThan(0);
  });

  it('should skip already compacted messages', () => {
    const messages = [
      createUserMessage('Question'),
      {
        id: 'msg-1',
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolName: 'read_file',
            toolCallId: 'tc-1',
            output: { type: 'text', value: 'Read file.ts → 100 lines' },
            _compacted: true,
            _originalSize: 5000,
          },
        ],
      } as unknown as ModelMessage,
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
      keepRecentSteps: 0,
      protectedTools: new Set(['MyProtectedTool'])};

    const result = manageToolOutputLifecycle(messages, config);
    const item = getResultItem(result.messages[1] as ModelMessage);
    expect(item._compacted).toBeUndefined();
  });

  it('should handle mcp_ prefixed tools', () => {
    const messages = [
      createUserMessage('Question'),
      createToolMessage('mcp_myserver', { result: 'x'.repeat(10000) }),
    ];

    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    const item = ((result.messages[1] as unknown as Record<string, unknown>).content as any[])[0];
    expect(item._compacted).toBe(true);
  });

  // ── 步骤 6 验收:单 user 轮内按 step 老化 ──
  // 见 docs/compaction-execution-plan.md 步骤 6
  it('ages tool outputs by step count within a single user turn', () => {
    // 单个 user 轮 + 50 次工具调用(每次输出 300 字符,低于 largeOutputThreshold)
    const messages: ModelMessage[] = [createUserMessage('One big agentic task')];
    for (let i = 0; i < 50; i++) {
      messages.push(createToolMessage('read_file', { path: `src/f${i}.ts`, content: 'x'.repeat(300) }, `tc-${i}`));
    }

    const keepRecentSteps = 3;
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps });

    // 只有最近 3 个 step 的输出保持完整
    for (let i = 1; i <= 50; i++) {
      const item = getResultItem(result.messages[i]);
      if (i <= 50 - keepRecentSteps) {
        expect(item._compacted, `step ${i} should be compacted`).toBe(true);
      } else {
        expect(item._compacted, `step ${i} should stay intact`).toBeUndefined();
      }
    }
  });

  it('ages old skill outputs while keeping the current one intact', () => {
    // skill 输出作为验收用例:旧的 skill 输出压缩为一行元信息,最近的保持完整
    const skillOutput = { success: true, skillName: 'frontend-design', _skillOutput: 'y'.repeat(5000) };
    const messages: ModelMessage[] = [
      createUserMessage('Build me a page'),
      createToolMessage('skill', skillOutput, 'tc-old'),
      createToolMessage('read_file', { path: 'a.ts', content: 'x'.repeat(300) }, 'tc-mid'),
      createToolMessage('skill', { ...skillOutput, _skillOutput: 'z'.repeat(3000) }, 'tc-new'),
    ];

    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 1 });

    const oldSkill = getResultItem(result.messages[1] as ModelMessage);
    expect(oldSkill._compacted).toBe(true);
    expect(oldSkill.output.value).toContain("Skill 'frontend-design'");

    const newSkill = getResultItem(result.messages[3] as ModelMessage);
    expect(newSkill._compacted).toBeUndefined();
  });
});

// ============================================================
// Lifecycle (Layer 2) — UIMessage 格式（.parts 数组）
// ============================================================
// 从 DB 加载的历史是 UIMessage:工具结果是 type=`tool-<name>` 或
// `dynamic-tool` 的 part,state=output-available,带 .input 字段。
// 生产事故:此格式此前不被识别,加载时 Layer 2 静默失效,
// 上下文膨胀到 525k tokens(2026-07-21)。
describe('manageToolOutputLifecycle (UIMessage .parts)', () => {
  function createUIToolMessage(toolName: string, input: unknown, output: unknown, toolCallId = 'tc-1'): ModelMessage {
    return {
      id: `msg-${toolCallId}`,
      role: 'assistant',
      parts: [
        {
          type: `tool-${toolName}`,
          toolCallId,
          state: 'output-available',
          input,
          output,
        },
      ],
    } as unknown as ModelMessage;
  }

  function createUIUserMessage(text: string): ModelMessage {
    return {
      id: `msg-user-${text.length}`,
      role: 'user',
      parts: [{ type: 'text', text }],
    } as unknown as ModelMessage;
  }

  function getUIPart(msg: unknown): any {
    return ((msg as Record<string, unknown>).parts as any[])[0];
  }

  it('compresses old UIMessage tool parts beyond keepRecentSteps and frees tokens', () => {
    const largeOutput = 'x'.repeat(10000);
    const messages = [
      createUIUserMessage('First'),
      createUIToolMessage('read_file', { filePath: 'src/a.ts' }, { path: 'src/a.ts', content: largeOutput, totalLines: 200 }, 'tc-1'),
      createUIUserMessage('Second'),
      createUIToolMessage('bash', { command: 'npm test' }, { command: 'npm test', stdout: largeOutput, exitCode: 0 }, 'tc-2'),
      createUIUserMessage('Third'),
      createUIToolMessage('read_file', { filePath: 'src/b.ts' }, { path: 'src/b.ts', content: 'y'.repeat(300), totalLines: 10 }, 'tc-3'),
    ];

    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 1 });

    expect(result.tokensFreed).toBeGreaterThan(0);

    const item1 = getUIPart(result.messages[1]);
    expect(item1._compacted).toBe(true);
    expect(item1.output.value).toContain('Read');
    expect(item1.output.value).toContain('src/a.ts');
    expect(item1.type).toBe('tool-read_file'); // part 类型保持不变

    const item3 = getUIPart(result.messages[3]);
    expect(item3._compacted).toBe(true);
    expect(item3.output.value).toContain('Bash');

    // 最近 1 个 step 保持完整
    const item5 = getUIPart(result.messages[5]);
    expect(item5._compacted).toBeUndefined();
  });

  it('compresses huge UIMessage tool part even within keepRecentSteps', () => {
    const messages = [
      createUIUserMessage('Q'),
      createUIToolMessage('read_file', { filePath: 'a.ts' }, { path: 'a.ts', content: 'x'.repeat(20000) }),
    ];
    const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);
    const item = getUIPart(result.messages[1]);
    expect(item._compacted).toBe(true);
    expect(item._originalSize).toBeGreaterThan(0);
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it('skips input-streaming / input-available parts (no output yet)', () => {
    const messages = [
      createUIUserMessage('Q'),
      {
        id: 'msg-pending',
        role: 'assistant',
        parts: [
          { type: 'tool-read_file', toolCallId: 'tc-p', state: 'input-available', input: { filePath: 'a.ts' } },
        ],
      } as unknown as ModelMessage,
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    expect(result.tokensFreed).toBe(0);
    expect(getUIPart(result.messages[1])._compacted).toBeUndefined();
  });

  it('handles dynamic-tool parts via .toolName field', () => {
    const messages = [
      createUIUserMessage('Q'),
      {
        id: 'msg-dyn',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'mcp_myserver',
            toolCallId: 'tc-d',
            state: 'output-available',
            input: {},
            output: { result: 'x'.repeat(10000) },
          },
        ],
      } as unknown as ModelMessage,
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    const item = getUIPart(result.messages[1]);
    expect(item._compacted).toBe(true);
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it('preserves non-tool parts (text/reasoning) in mixed assistant message', () => {
    const messages = [
      createUIUserMessage('Q'),
      {
        id: 'msg-mixed',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'thinking...' },
          {
            type: 'tool-bash',
            toolCallId: 'tc-m',
            state: 'output-available',
            input: { command: 'ls' },
            output: { command: 'ls', stdout: 'x'.repeat(9000), exitCode: 0 },
          },
          { type: 'text', text: 'done' },
        ],
      } as unknown as ModelMessage,
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    const parts = (result.messages[1] as unknown as Record<string, unknown>).parts as any[];
    expect(parts[0]).toEqual({ type: 'reasoning', text: 'thinking...' });
    expect(parts[1]._compacted).toBe(true);
    expect(parts[2]).toEqual({ type: 'text', text: 'done' });
  });

  it('protects error results in UIMessage format', () => {
    const messages = [
      createUIUserMessage('Q'),
      createUIToolMessage('bash', { command: 'bad' }, { command: 'bad', stdout: 'x'.repeat(9000), exitCode: 1 }),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    expect(getUIPart(result.messages[1])._compacted).toBeUndefined();
  });
});

// ============================================================
// Tool Meta Extractors Tests
// ============================================================
// 用例覆盖内置工具的真实输出格式(输入回显、JSON 字符串),
// 见 docs/built-in-tools-compaction-analysis.md #1/#2。
describe('extractToolMeta', () => {
  // ── 注册名(snake_case)+ 真实输出格式:args 恒为 null 也要能提取 ──

  it('read_file: extracts path from result echo (args=null)', () => {
    const meta = extractToolMeta('read_file', null, {
      path: 'packages/core/src/index.ts',
      content: '```typescript\n1: line1\n2: line2\n3: line3\n```',
      totalLines: 120,
      startLine: 1,
      shownLines: 120,
      truncated: false,
      type: 'text',
    });
    expect(meta).toContain('Read');
    expect(meta).toContain('packages/core/src/index.ts');
    expect(meta).toContain('120 lines');
  });

  it('bash: extracts command from result echo (args=null)', () => {
    const meta = extractToolMeta('bash', null, {
      stdout: 'All tests passed\nDone in 3.2s',
      stderr: '',
      exitCode: 0,
      command: 'npm test',
      timedOut: false,
      duration: 3200,
    });
    expect(meta).toContain('Bash');
    expect(meta).toContain('npm test');
    expect(meta).toContain('exit 0');
    expect(meta).toContain('Done in 3.2s');
  });

  it('grep: parses JSON string result and extracts pattern (args=null)', () => {
    const raw = JSON.stringify({
      pattern: 'extractToolMeta',
      searchPath: '/repo',
      totalMatches: 12,
      matchesReturned: 12,
      truncated: false,
      searchEngine: 'ripgrep',
      matches: [
        { file: 'a.ts', line: 1, content: 'x' },
        { file: 'a.ts', line: 5, content: 'y' },
        { file: 'b.ts', line: 9, content: 'z' },
      ],
    }, null, 2);
    const meta = extractToolMeta('grep', null, raw);
    expect(meta).toContain('Grep');
    expect(meta).toContain('extractToolMeta');
    // grep 默认改为紧凑文本输出后不再有 matches 数组,meta 只报总数
    expect(meta).toContain('12 matches');
  });

  it('glob: parses JSON string result and extracts pattern (args=null)', () => {
    const raw = JSON.stringify({
      pattern: '**/*.ts',
      searchDir: '/repo',
      files: ['a.ts', 'b.ts', 'c.ts'],
      count: 3,
      totalCount: 3,
      truncated: false,
    }, null, 2);
    const meta = extractToolMeta('glob', null, raw);
    expect(meta).toContain('Glob');
    expect(meta).toContain('**/*.ts');
    expect(meta).toContain('3 files');
  });

  it('web_fetch: parses JSON string result and extracts url (args=null)', () => {
    const raw = JSON.stringify({
      success: true,
      url: 'https://example.com/docs',
      title: 'Example Docs',
      contentType: 'text/html',
      content: 'a'.repeat(5000),
      truncated: false,
      originalLength: 5000,
    }, null, 2);
    const meta = extractToolMeta('web_fetch', null, raw);
    expect(meta).toContain('WebFetch');
    expect(meta).toContain('https://example.com/docs');
    expect(meta).toContain('5000 chars');
  });

  it('web_fetch: reports errors from failed fetches', () => {
    const raw = JSON.stringify({ success: false, url: 'https://x.com', error: 'HTTP 404: Not Found' });
    const meta = extractToolMeta('web_fetch', null, raw);
    expect(meta).toContain('https://x.com');
    expect(meta).toContain('error');
    expect(meta).toContain('404');
  });

  it('edit_file: extracts path and summary from result echo (args=null)', () => {
    const meta = extractToolMeta('edit_file', null, {
      path: 'src/app.ts',
      diff: '--- a\n+++ b\n...',
      summary: '+5 -2',
    });
    expect(meta).toContain('Edit');
    expect(meta).toContain('src/app.ts');
    expect(meta).toContain('+5 -2');
  });

  it('write_file: extracts path from result echo (args=null)', () => {
    const meta = extractToolMeta('write_file', null, {
      path: 'src/new.ts',
      size: 1024,
      mode: 'overwrite',
      created: true,
    });
    expect(meta).toContain('Write');
    expect(meta).toContain('src/new.ts');
  });

  it('bash: reports error results with message', () => {
    const meta = extractToolMeta('bash', null, {
      error: true,
      command: 'sudo rm -rf /',
      message: 'Security block: matches blacklist',
    });
    expect(meta).toContain('sudo rm -rf /');
    expect(meta).toContain('error');
    expect(meta).toContain('Security block');
  });

  // ── 首字母大写别名(兼容旧格式)+ args fallback ──

  it('should extract Read metadata via capitalized alias with args fallback', () => {
    const meta = extractToolMeta('Read', { file_path: '/src/index.ts' }, { content: 'line1\nline2\nline3' });
    expect(meta).toContain('Read');
    expect(meta).toContain('/src/index.ts');
    expect(meta).toContain('3 lines');
  });

  it('should extract Bash metadata via capitalized alias with args fallback', () => {
    const meta = extractToolMeta('Bash', { command: 'ls -la' }, { stdout: 'file1\nfile2', exitCode: 0 });
    expect(meta).toContain('Bash');
    expect(meta).toContain('ls -la');
    expect(meta).toContain('exit 0');
  });

  it('should extract Grep metadata via capitalized alias with args fallback', () => {
    const meta = extractToolMeta('Grep', { pattern: 'TODO' }, { matches: [{ file: 'a.ts' }, { file: 'b.ts' }] });
    expect(meta).toContain('Grep');
    expect(meta).toContain('TODO');
    expect(meta).toContain('2 matches');
  });

  it('should prefer camelCase args when result has no echo', () => {
    const meta = extractToolMeta('read_file', { filePath: 'src/via-args.ts' }, { content: 'a\nb' });
    expect(meta).toContain('src/via-args.ts');
  });

  it('skill: extracts skill name and output length (args=null)', () => {
    const meta = extractToolMeta('skill', null, {
      success: true,
      skillName: 'frontend-design',
      skillPath: '/skills/frontend-design/SKILL.md',
      allowedTools: ['read_file', 'write_file'],
      _skillOutput: 'x'.repeat(15000),
    });
    expect(meta).toContain('Skill');
    expect(meta).toContain('frontend-design');
    expect(meta).toContain('15000 chars');
  });

  it('skill: reports error when skill not found', () => {
    const meta = extractToolMeta('skill', null, {
      success: false,
      skillName: 'nonexistent-skill',
      allowedTools: [],
      error: 'Unknown skill: "nonexistent-skill"',
    });
    expect(meta).toContain('nonexistent-skill');
    expect(meta).toContain('error');
  });

  it('read_wiki_page: extracts page name and content length (args=null)', () => {
    const meta = extractToolMeta('read_wiki_page', null, {
      found: true,
      name: 'LLM-基础',
      description: '大语言模型基础知识',
      category: 'technical',
      content: 'a'.repeat(8000),
    });
    expect(meta).toContain('ReadWiki');
    expect(meta).toContain('LLM-基础');
    expect(meta).toContain('8000 chars');
  });

  it('read_wiki_page: reports not found', () => {
    const meta = extractToolMeta('read_wiki_page', null, {
      found: false,
      message: '页面 "不存在" 不存在',
    });
    expect(meta).toContain('not found');
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
