import { describe, it, expect } from 'vitest';
import type { ModelMessage } from 'ai';
import { extractActionLog, renderActionLog, renderKeysOnlyActionLog } from '../action-log';
import { manageToolOutputLifecycle } from '../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types';

// ============================================================
// action-log: key/value 分离的根
// ============================================================
// extractActionLog 必须抽出 tool-call 输入(key),renderActionLog 渲染时 key 永远全文。
// 这是修复"摘要器丢 provenance"的核心--替代 extractMessageText 丢 key 的行为。

function uiUser(text: string): ModelMessage {
  return { id: 'u', role: 'user', parts: [{ type: 'text', text }] } as unknown as ModelMessage;
}

function uiToolPart(toolName: string, input: unknown, output: unknown, toolCallId = 'tc-1'): ModelMessage {
  return {
    id: 'a-' + toolCallId,
    role: 'assistant',
    parts: [{
      type: `tool-${toolName}` as any,
      toolCallId,
      state: 'output-available',
      input,
      output: { type: 'text', value: typeof output === 'string' ? output : JSON.stringify(output) },
    }],
  } as unknown as ModelMessage;
}

function modelToolResult(toolName: string, output: unknown, toolCallId = 'tc-1'): ModelMessage {
  return {
    id: 't-' + toolCallId,
    role: 'tool',
    content: [{ type: 'tool-result', toolName, toolCallId, output: { type: 'json', value: output } }],
  } as unknown as ModelMessage;
}

function modelToolCall(toolName: string, args: unknown, toolCallId = 'tc-1'): ModelMessage {
  return {
    id: 'a-' + toolCallId,
    role: 'assistant',
    content: [{ type: 'tool-call', toolName, toolCallId, args } as any],
  } as unknown as ModelMessage;
}

describe('extractActionLog', () => {
  it('UIMessage: 抽出 tool-call 输入(key)+ 输出(value)', () => {
    const msgs = [
      uiUser('读文件'),
      uiToolPart('web_fetch', { url: 'https://raw.githubusercontent.com/yzfly/douyin-mcp-server/main/douyin_downloader.py' }, 'def download(): ...'),
    ];
    const log = extractActionLog(msgs);
    expect(log).toHaveLength(2);
    expect(log[0].kind).toBe('text');
    expect(log[0].text).toBe('读文件');
    expect(log[1].kind).toBe('tool');
    expect(log[1].toolName).toBe('web_fetch');
    expect(log[1].input).toEqual({ url: 'https://raw.githubusercontent.com/yzfly/douyin-mcp-server/main/douyin_downloader.py' });
    expect(log[1].valueState).toBe('full');
  });

  it('ModelMessage: tool-call(args=key)与 tool-result(value)分别捕获', () => {
    const msgs = [
      modelToolCall('read_file', { filePath: '/abs/path/a.ts' }, 'tc-1'),
      modelToolResult('read_file', { path: '/abs/path/a.ts', content: 'x'.repeat(100) }, 'tc-1'),
    ];
    const log = extractActionLog(msgs);
    // tool-call(key) + tool-result(value)
    const toolEntries = log.filter((e) => e.kind === 'tool');
    expect(toolEntries).toHaveLength(2);
    // 第一条:key 有 input,args 无 output
    expect(toolEntries[0].input).toEqual({ filePath: '/abs/path/a.ts' });
    expect(toolEntries[0].outputRaw).toBeUndefined();
    // 第二条:value 有 output,无 input
    expect(toolEntries[1].outputRaw).toContain('x'.repeat(100));
    expect(toolEntries[1].input).toBeUndefined();
  });

  it('UIMessage: 压缩后的 value 标记 meta/truncated 状态', () => {
    const big = 'line\n'.repeat(4000);
    const msgs = [
      uiToolPart('read_file', { filePath: 'big.ts' }, { path: 'big.ts', content: big, totalLines: 4000 }, 'tc-1'),
      uiUser('继续'),
    ];
    // 当前步超大 -> 截断
    const result = manageToolOutputLifecycle(msgs, DEFAULT_LIFECYCLE_CONFIG);
    const log = extractActionLog(result.messages);
    const toolEntry = log.find((e) => e.kind === 'tool');
    expect(toolEntry?.valueState).toBe('truncated');
    // key 仍在
    expect(toolEntry?.input).toEqual({ filePath: 'big.ts' });
  });
});

describe('renderActionLog', () => {
  it('key(工具输入)永远全文渲染,含 URL/path', () => {
    const url = 'https://raw.githubusercontent.com/yzfly/douyin-mcp-server/main/douyin_downloader.py';
    const msgs = [uiToolPart('web_fetch', { url }, '源码内容')];
    const rendered = renderActionLog(extractActionLog(msgs));
    expect(rendered).toContain('web_fetch');
    expect(rendered).toContain(url); // key 全文
    expect(rendered).toContain('源码内容'); // value
  });

  it('value 超长时截断,但 key 不截断', () => {
    const bigOutput = 'x'.repeat(5000);
    const msgs = [uiToolPart('bash', { command: 'npm run build' }, bigOutput)];
    const rendered = renderActionLog(extractActionLog(msgs));
    expect(rendered).toContain('npm run build'); // key 全文
    expect(rendered.length).toBeLessThan(bigOutput.length + 500); // value 被截断
  });

  it('text 类消息正常渲染', () => {
    const msgs = [uiUser('请分析项目')];
    const rendered = renderActionLog(extractActionLog(msgs));
    expect(rendered).toContain('User: 请分析项目');
  });
});

describe('renderKeysOnlyActionLog', () => {
  it('只输出 key(工具调用),用于 checkpoint provenance 段', () => {
    const msgs = [
      uiUser('读'),
      uiToolPart('web_fetch', { url: 'https://example.com/a.py' }, 'content'),
      uiToolPart('read_file', { filePath: '/local/b.ts' }, 'content2'),
    ];
    const keys = renderKeysOnlyActionLog(extractActionLog(msgs));
    expect(keys).toContain('web_fetch');
    expect(keys).toContain('https://example.com/a.py');
    expect(keys).toContain('read_file');
    expect(keys).toContain('/local/b.ts');
    // 不含 value 内容
    expect(keys).not.toContain('content');
    expect(keys).not.toContain('content2');
  });
});

// ============================================================
// 不变式:lifecycle 压缩后,key(工具调用 input)必须原样保留
// ============================================================
describe('invariant: key 永不被驱逐', () => {
  it('UIMessage: meta 化后 input 字段保留', () => {
    const big = 'x'.repeat(10000);
    const msgs = [
      uiUser('Q'),
      uiToolPart('read_file', { filePath: 'src/big.ts' }, { path: 'src/big.ts', content: big }, 'tc-1'),
      uiUser('继续'),
      uiToolPart('bash', { command: 'echo done' }, 'y'.repeat(10000), 'tc-2'), // 当前步
    ];
    const result = manageToolOutputLifecycle(msgs, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 1 });
    const log = extractActionLog(result.messages);
    // 旧 read_file(tc-1)被 meta 化,但 input(filePath)必须保留
    const oldRead = log.find((e) => e.toolName === 'read_file' && (e.input as any)?.filePath === 'src/big.ts');
    expect(oldRead).toBeDefined();
    expect(oldRead?.valueState).toBe('meta');
    expect(oldRead?.input).toEqual({ filePath: 'src/big.ts' }); // key 仍在
  });

  it('ModelMessage: 压缩后 tool-result 的对应 tool-call args 保留', () => {
    // ModelMessage tool-call(key)与 tool-result(value)分离,lifecycle 压 value 不删 key
    const big = 'x'.repeat(10000);
    const msgs: ModelMessage[] = [
      { id: 'u', role: 'user', content: [{ type: 'text', text: 'Q' }] } as unknown as ModelMessage,
      {
        id: 'a-tc-1',
        role: 'assistant',
        content: [
          { type: 'tool-call', toolName: 'read_file', toolCallId: 'tc-1', args: { filePath: 'src/big.ts' } } as any,
          { type: 'tool-result', toolName: 'read_file', toolCallId: 'tc-1', output: { type: 'json', value: { path: 'src/big.ts', content: big } } },
        ],
      } as unknown as ModelMessage,
    ];
    const result = manageToolOutputLifecycle(msgs, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    const log = extractActionLog(result.messages);
    // tool-call(key)应保留 args
    const keyEntry = log.find((e) => e.kind === 'tool' && e.outputRaw === undefined);
    expect(keyEntry?.input).toEqual({ filePath: 'src/big.ts' });
  });
});
