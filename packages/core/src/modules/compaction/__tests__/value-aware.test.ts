import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import type { ModelMessage } from 'ai';
import { manageToolOutputLifecycle } from '../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types';

// ============================================================
// 8.3 价值感知压缩(error 保护 + 同文件去重 + 引用感知)
// 见 docs/compaction-execution-plan.md 步骤 8.3
// ============================================================

function userMessage(text: string): ModelMessage {
  return { id: `u-${Math.random()}`, role: 'user', content: [{ type: 'text', text }] } as unknown as ModelMessage;
}

function assistantMessage(text: string): ModelMessage {
  return { id: `a-${Math.random()}`, role: 'assistant', content: [{ type: 'text', text }] } as unknown as ModelMessage;
}

function toolMessage(toolName: string, output: unknown, toolCallId: string): ModelMessage {
  return {
    id: `t-${toolCallId}`,
    role: 'tool',
    content: [{ type: 'tool-result', toolName, toolCallId, output: { type: 'json', value: output } }],
  } as unknown as ModelMessage;
}

function item(msg: ModelMessage): any {
  return ((msg as unknown as Record<string, unknown>).content as any[])[0];
}

describe('error result protection', () => {
  it('does not compact a bash result with a non-zero exit code even when old', () => {
    const messages = [
      userMessage('run the build'),
      toolMessage('bash', { command: 'npm run build', stdout: 'x'.repeat(5000), stderr: 'TypeError at line 42', exitCode: 1 }, 'tc-1'),
      userMessage('Q2'),
      toolMessage('read_file', { path: 'a.ts', content: 'y'.repeat(300) }, 'tc-2'),
      userMessage('Q3'),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 1 });
    // 错误结果被保护,不压缩
    expect(item(result.messages[1])._compacted).toBeUndefined();
  });

  it('protects error:true (read) and success:false (web_fetch) results', () => {
    const messages = [
      userMessage('Q'),
      toolMessage('read_file', { error: true, path: 'missing.ts', message: 'ENOENT' }, 'tc-1'),
      toolMessage('web_fetch', { success: false, url: 'http://x', error: 'HTTP 500' }, 'tc-2'),
      userMessage('Q2'),
      toolMessage('read_file', { path: 'ok.ts', content: 'z'.repeat(300) }, 'tc-3'),
      userMessage('Q3'),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    // 两个错误结果不压缩(注意:error 结果体积小,本就可能低于 200 阈值,这里断言未标记压缩)
    expect(item(result.messages[1])._compacted).toBeUndefined();
    expect(item(result.messages[2])._compacted).toBeUndefined();
  });
});

describe('duplicate read dedup', () => {
  it('compacts earlier reads of the same file, keeps the last intact', () => {
    const messages = [
      userMessage('read the file'),
      toolMessage('read_file', { path: 'src/big.ts', content: 'v1'.repeat(3000) }, 'tc-1'),
      userMessage('read it again'),
      toolMessage('read_file', { path: 'src/big.ts', content: 'v2'.repeat(3000) }, 'tc-2'),
      userMessage('now'),
    ];
    // keepRecentSteps 足够大,单看去重规则:更早那次应被压缩
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 10 });
    expect(item(result.messages[1])._compacted).toBe(true);
    expect(item(result.messages[3])._compacted).toBeUndefined();
  });
});

describe('reference awareness', () => {
  it('delays aging of a result whose path is referenced in later assistant text', () => {
    const messages = [
      userMessage('read two files'),
      toolMessage('read_file', { path: 'src/referenced.ts', content: 'a'.repeat(300) }, 'tc-1'),
      toolMessage('read_file', { path: 'src/unreferenced.ts', content: 'b'.repeat(300) }, 'tc-2'),
      assistantMessage('The bug is in src/referenced.ts on the parse function.'),
      userMessage('Q2'),
      toolMessage('read_file', { path: 'src/recent.ts', content: 'c'.repeat(300) }, 'tc-3'),
      userMessage('Q3'),
    ];
    // keepRecentSteps=1 会把 tc-1/tc-2 都推到边界外;被引用的 tc-1 应豁免
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 1 });
    // tc-1 被后续 assistant 文本引用 → 延迟老化,保持完整
    expect(item(result.messages[1])._compacted).toBeUndefined();
    // tc-2 未被引用且超出边界 → 压缩
    expect(item(result.messages[2])._compacted).toBe(true);
  });

  it('reference does not exempt a stale duplicate read', () => {
    const messages = [
      userMessage('read'),
      toolMessage('read_file', { path: 'src/dup.ts', content: 'old'.repeat(2000) }, 'tc-1'),
      assistantMessage('checking src/dup.ts'),
      toolMessage('read_file', { path: 'src/dup.ts', content: 'new'.repeat(2000) }, 'tc-2'),
      userMessage('Q'),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 10 });
    // 即使被引用,更早的重复读取仍被压缩(去重优先于引用豁免)
    expect(item(result.messages[1])._compacted).toBe(true);
    expect(item(result.messages[3])._compacted).toBeUndefined();
  });
});
