import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createReadFileTool } from '../read';
import { createBashTool } from '../bash';

// ============================================================
// 8.7 read_file/bash 加 toModelOutput 纯文本输出
// 见 docs/compaction-execution-plan.md 步骤 8.7
// ============================================================

// toModelOutput 把结构化结果转成发给模型的纯文本,规避 JSON 转义开销。
// tool.toModelOutput 由 AI SDK 在序列化时调用,这里直接调用验证其映射。

function callToModelOutput(tool: any, output: unknown): string {
  const r = tool.toModelOutput({ output });
  return r.value as string;
}

describe('read_file toModelOutput', () => {
  const tool = createReadFileTool({ cwd: process.cwd() }) as any;

  it('emits raw content as text (no JSON escaping)', () => {
    const output = { path: 'a.ts', content: '```ts\n1: const x = "hi";\n```', type: 'text' };
    const text = callToModelOutput(tool, output);
    expect(text).toContain('const x = "hi";');
    // 不应包含 JSON 转义的引号
    expect(text).not.toContain('\\"');
    expect(text.startsWith('a.ts')).toBe(true);
  });

  it('formats error results compactly', () => {
    const text = callToModelOutput(tool, { error: true, path: 'missing.ts', message: 'ENOENT' });
    expect(text).toContain('❌');
    expect(text).toContain('ENOENT');
    expect(text).toContain('missing.ts');
  });
});

describe('bash toModelOutput', () => {
  const tool = createBashTool({ cwd: process.cwd() }) as any;

  it('joins stdout and non-zero exit into plain text', () => {
    const text = callToModelOutput(tool, { stdout: 'hello\nworld', stderr: '', exitCode: 0, command: 'echo' });
    expect(text).toBe('hello\nworld');
  });

  it('surfaces stderr and non-zero exit code', () => {
    const text = callToModelOutput(tool, { stdout: '', stderr: 'boom', exitCode: 2, command: 'x' });
    expect(text).toContain('boom');
    expect(text).toContain('exit code: 2');
  });

  it('formats security/error block', () => {
    const text = callToModelOutput(tool, { error: true, command: 'rm -rf /', message: 'Security block: ...' });
    expect(text).toContain('❌');
    expect(text).toContain('Security block');
  });

  it('passes through background start message', () => {
    const text = callToModelOutput(tool, { background: true, pid: 123, message: 'Process started in background (PID: 123).' });
    expect(text).toContain('background');
  });
});
