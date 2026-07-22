// ============================================================
// message-view 测试
// ============================================================
// 验证 extractToolResultView / applyCompactionPatches 对
// UIMessage (.parts) 和 ModelMessage (.content) 两种格式的
// 读写正确性与无损性。
// ============================================================

import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import type { PipelineMessage } from '../../../services/config/compaction-types';
import {
  extractToolResultView,
  applyCompactionPatches,
} from '../message-view';

// ============================================================
// Helpers
// ============================================================

function makeUIMsg(role: string, parts: Record<string, unknown>[]): PipelineMessage {
  return { id: 'm1', role, parts } as unknown as PipelineMessage;
}

function makeModelMsg(role: string, content: Record<string, unknown>[]): PipelineMessage {
  return { role, content } as PipelineMessage;
}

// ============================================================
// extractToolResultView — UIMessage
// ============================================================

describe('extractToolResultView — UIMessage (.parts)', () => {
  it('extracts typed tool part (tool-read_file) with output', () => {
    const msg = makeUIMsg('assistant', [
      {
        type: 'tool-read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { filePath: 'src/a.ts' },
        output: { path: 'src/a.ts', content: 'hello\nworld', totalLines: 2 },
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.format).toBe('ui');
    expect(view.toolResults).toHaveLength(1);
    expect(view.toolResults[0].toolName).toBe('read_file');
    expect(view.toolResults[0].toolCallId).toBe('tc-1');
    expect(view.toolResults[0].input).toEqual({ filePath: 'src/a.ts' });
    expect(view.toolResults[0].refIndex).toBe(0);
    expect(view.toolResults[0].isCompacted).toBe(false);
    expect(view.toolResults[0].isError).toBe(false);
  });

  it('extracts dynamic-tool part via .toolName field', () => {
    const msg = makeUIMsg('assistant', [
      {
        type: 'dynamic-tool',
        toolName: 'mcp_myserver',
        toolCallId: 'tc-dyn',
        state: 'output-available',
        input: { query: 'test' },
        output: { result: 'done' },
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults).toHaveLength(1);
    expect(view.toolResults[0].toolName).toBe('mcp_myserver');
    expect(view.toolResults[0].input).toEqual({ query: 'test' });
  });

  it('collects text and reasoning parts into textContent', () => {
    const msg = makeUIMsg('assistant', [
      { type: 'reasoning', text: 'thinking...' },
      { type: 'text', text: 'Here is the result:' },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults).toHaveLength(0);
    expect(view.textContent).toContain('thinking...');
    expect(view.textContent).toContain('Here is the result:');
  });

  it('skips input-streaming / input-available parts (no output yet)', () => {
    const msg = makeUIMsg('assistant', [
      {
        type: 'tool-read_file',
        toolCallId: 'tc-pending',
        state: 'input-available',
        input: { filePath: 'a.ts' },
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults).toHaveLength(0);
  });

  it('detects already compacted parts', () => {
    const msg = makeUIMsg('assistant', [
      {
        type: 'tool-read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        output: { type: 'text', value: 'Read src/a.ts → 100 lines' },
        _compacted: true,
        _originalSize: 5000,
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults[0].isCompacted).toBe(true);
  });

  it('detects error results (exitCode ≠ 0)', () => {
    const msg = makeUIMsg('assistant', [
      {
        type: 'tool-bash',
        toolCallId: 'tc-err',
        state: 'output-available',
        input: { command: 'bad-cmd' },
        output: { command: 'bad-cmd', stdout: 'error', exitCode: 1 },
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults[0].isError).toBe(true);
  });

  it('detects error results (success: false)', () => {
    const msg = makeUIMsg('assistant', [
      {
        type: 'tool-web_fetch',
        toolCallId: 'tc-err2',
        state: 'output-available',
        input: { url: 'https://fail.example' },
        output: { success: false, error: 'Not found' },
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults[0].isError).toBe(true);
  });

  it('preserves non-tool parts without extracting them as tool results', () => {
    const msg = makeUIMsg('assistant', [
      { type: 'reasoning', text: 'let me check' },
      {
        type: 'tool-read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        output: { path: 'f.ts', content: 'data', totalLines: 5 },
      },
      { type: 'text', text: 'done' },
      { type: 'file', mediaType: 'image/png', data: 'aaa' } as Record<string, unknown>,
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults).toHaveLength(1);
    expect(view.toolResults[0].refIndex).toBe(1); // index 1 in parts array
  });

  it('outputSize reflects serialized output size', () => {
    const output = { path: 'a.ts', content: 'x'.repeat(1000) };
    const msg = makeUIMsg('assistant', [
      {
        type: 'tool-read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        output,
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults[0].outputSize).toBeGreaterThanOrEqual(1000);
  });
});

// ============================================================
// extractToolResultView — ModelMessage
// ============================================================

describe('extractToolResultView — ModelMessage (.content)', () => {
  it('extracts tool-result items', () => {
    const msg = makeModelMsg('tool', [
      {
        type: 'tool-result',
        toolName: 'read_file',
        toolCallId: 'tc-1',
        output: { type: 'json', value: { path: 'src/a.ts', content: 'data', totalLines: 10 } },
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.format).toBe('model');
    expect(view.toolResults).toHaveLength(1);
    expect(view.toolResults[0].toolName).toBe('read_file');
    expect(view.toolResults[0].input).toBeUndefined(); // ModelMessage has no input
    expect(view.toolResults[0].isCompacted).toBe(false);
  });

  it('collects text content from text parts', () => {
    const msg = makeModelMsg('assistant', [
      { type: 'text', text: 'Hello world' },
      { type: 'tool-result', toolName: 'bash', output: { type: 'text', value: 'ok' } },
    ]);

    const view = extractToolResultView(msg);
    expect(view.textContent).toContain('Hello world');
    expect(view.textContent).toContain('ok');
  });

  it('handles tool-call items (adds args to textContent)', () => {
    const msg = makeModelMsg('assistant', [
      { type: 'tool-call', toolName: 'read_file', args: { filePath: 'a.ts' } },
      { type: 'tool-result', toolName: 'read_file', output: { type: 'text', value: 'data' } },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults).toHaveLength(1);
    expect(view.textContent).toContain('filePath');
  });

  it('detects already compacted tool-result items', () => {
    const msg = makeModelMsg('tool', [
      {
        type: 'tool-result',
        toolName: 'read_file',
        output: { type: 'text', value: 'Read a.ts → 10 lines' },
        _compacted: true,
        _originalSize: 2000,
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults[0].isCompacted).toBe(true);
  });

  it('detects error results', () => {
    const msg = makeModelMsg('tool', [
      {
        type: 'tool-result',
        toolName: 'bash',
        output: { type: 'json', value: { command: 'bad', exitCode: 1 } },
      },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults[0].isError).toBe(true);
  });
});

// ============================================================
// applyCompactionPatches
// ============================================================

describe('applyCompactionPatches', () => {
  // ── UIMessage patching ──

  it('applies patches to UIMessage tool parts and preserves non-tool parts', () => {
    const msg = makeUIMsg('assistant', [
      { type: 'reasoning', text: 'thinking...' },
      {
        type: 'tool-read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { filePath: 'a.ts' },
        output: { path: 'a.ts', content: 'x'.repeat(5000), totalLines: 100 },
      },
      { type: 'text', text: 'done' },
    ]);

    const { patched, freed } = applyCompactionPatches(msg, [
      { refIndex: 1, summary: 'Read a.ts → 100 lines' },
    ]);

    expect(freed).toBeGreaterThan(0);
    const parts = (patched as unknown as Record<string, unknown>).parts as Record<string, unknown>[];
    // reasoning unchanged
    expect(parts[0]).toEqual({ type: 'reasoning', text: 'thinking...' });
    // tool part compacted
    expect(parts[1]._compacted).toBe(true);
    expect(parts[1]._originalSize).toBeGreaterThan(0);
    // preserve non-output fields
    expect(parts[1].type).toBe('tool-read_file');
    expect(parts[1].state).toBe('output-available');
    expect(parts[1].input).toEqual({ filePath: 'a.ts' });
    // text unchanged
    expect(parts[2]).toEqual({ type: 'text', text: 'done' });
  });

  it('does not patch non-tool parts at the same index', () => {
    const msg = makeUIMsg('assistant', [
      { type: 'text', text: 'hello' },
    ]);

    const { patched, freed } = applyCompactionPatches(msg, [
      { refIndex: 0, summary: 'should not apply' },
    ]);

    expect(freed).toBe(0);
    const parts = (patched as unknown as Record<string, unknown>).parts as Record<string, unknown>[];
    expect(parts[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('does not crash on patches to out-of-range indices', () => {
    const msg = makeUIMsg('assistant', [
      {
        type: 'tool-read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        output: { path: 'a.ts', content: 'data' },
      },
    ]);

    const { patched, freed } = applyCompactionPatches(msg, [
      { refIndex: 99, summary: 'nowhere' },
    ]);

    expect(freed).toBe(0);
    const parts = (patched as unknown as Record<string, unknown>).parts as Record<string, unknown>[];
    expect(parts[0]._compacted).toBeUndefined();
  });

  it('multiple patches for multi-tool UIMessage', () => {
    const msg = makeUIMsg('assistant', [
      {
        type: 'tool-read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        output: { path: 'a.ts', content: 'x'.repeat(3000) },
      },
      {
        type: 'tool-bash',
        toolCallId: 'tc-2',
        state: 'output-available',
        output: { command: 'ls', stdout: 'y'.repeat(3000), exitCode: 0 },
      },
    ]);

    const { patched, freed } = applyCompactionPatches(msg, [
      { refIndex: 0, summary: 'Read a.ts' },
      { refIndex: 1, summary: 'Bash ls → exit 0' },
    ]);

    expect(freed).toBeGreaterThan(3000);
    const parts = (patched as unknown as Record<string, unknown>).parts as Record<string, unknown>[];
    expect(parts[0]._compacted).toBe(true);
    expect(parts[1]._compacted).toBe(true);
  });

  // ── ModelMessage patching ──

  it('applies patches to ModelMessage tool-result items', () => {
    const msg = makeModelMsg('tool', [
      { type: 'tool-result', toolName: 'read_file', toolCallId: 'tc-1', output: { type: 'json', value: { path: 'a.ts', content: 'x'.repeat(5000) } } },
    ]);

    const { patched, freed } = applyCompactionPatches(msg, [
      { refIndex: 0, summary: 'Read a.ts → 100 lines' },
    ]);

    expect(freed).toBeGreaterThan(0);
    const content = (patched as unknown as Record<string, unknown>).content as Record<string, unknown>[];
    expect(content[0]._compacted).toBe(true);
    expect(content[0]._originalSize).toBeGreaterThan(0);
    expect((content[0].output as Record<string, unknown>).value).toBe('Read a.ts → 100 lines');
  });

  it('skips non-tool-result content items at patched index', () => {
    const msg = makeModelMsg('assistant', [
      { type: 'text', text: 'hello' },
    ]);

    const { patched, freed } = applyCompactionPatches(msg, [
      { refIndex: 0, summary: 'nope' },
    ]);

    expect(freed).toBe(0);
    const content = (patched as unknown as Record<string, unknown>).content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('skips already-compacted items (no double compaction)', () => {
    const msg = makeModelMsg('tool', [
      { type: 'tool-result', toolName: 'read_file', output: { type: 'text', value: 'already compacted' }, _compacted: true, _originalSize: 2000 },
    ]);

    const { patched, freed } = applyCompactionPatches(msg, [
      { refIndex: 0, summary: 'Read again' },
    ]);

    expect(freed).toBe(0);
  });
});

// ============================================================
// Round-trip: view → patch → verify
// ============================================================

describe('view → patch round-trip', () => {
  it('UIMessage: extract → decide → patch → verify toolParts unchanged', () => {
    const msg = makeUIMsg('assistant', [
      { type: 'reasoning', text: 'let me see' },
      {
        type: 'tool-read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { filePath: 'a.ts' },
        output: { path: 'a.ts', content: 'x'.repeat(5000), totalLines: 100 },
      },
      { type: 'text', text: 'result above' },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults).toHaveLength(1);
    expect(view.toolResults[0].isCompacted).toBe(false);

    const patches = view.toolResults.map((tr) => ({
      refIndex: tr.refIndex,
      summary: `Read ${(tr.output as Record<string, unknown>).path} → 100 lines`,
    }));

    const { patched, freed } = applyCompactionPatches(msg, patches);
    expect(freed).toBeGreaterThan(0);

    const parts = (patched as unknown as Record<string, unknown>).parts as Record<string, unknown>[];
    expect(parts[0]).toEqual({ type: 'reasoning', text: 'let me see' }); // untouched
    expect(parts[1]._compacted).toBe(true);
    expect(parts[1].type).toBe('tool-read_file'); // preserved
    expect(parts[2]).toEqual({ type: 'text', text: 'result above' }); // untouched
  });

  it('ModelMessage: extract → decide → patch → verify text untouched', () => {
    const msg = makeModelMsg('assistant', [
      { type: 'text', text: 'Let me check the file' },
      { type: 'tool-call', toolName: 'read_file', args: { filePath: 'b.ts' } },
      { type: 'tool-result', toolName: 'read_file', toolCallId: 'tc-1', output: { type: 'text', value: 'x'.repeat(4000) } },
    ]);

    const view = extractToolResultView(msg);
    expect(view.toolResults).toHaveLength(1);

    const patches = view.toolResults.map((tr) => ({
      refIndex: tr.refIndex,
      summary: 'Read b.ts → 50 lines',
    }));

    const { patched } = applyCompactionPatches(msg, patches);
    const content = (patched as unknown as Record<string, unknown>).content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: 'text', text: 'Let me check the file' });
    expect(content[1]).toEqual({ type: 'tool-call', toolName: 'read_file', args: { filePath: 'b.ts' } });
    expect(content[2]._compacted).toBe(true);
    expect((content[2].output as Record<string, unknown>).value).toBe('Read b.ts → 50 lines');
  });
});
