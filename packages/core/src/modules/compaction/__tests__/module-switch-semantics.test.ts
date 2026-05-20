// ============================================================
// Module Switch Semantics Tests
// ============================================================
// Tests that the compaction module respects the compactionEnabled flag

import { describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';

import { manageToolOutputLifecycle } from '../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types';

// ============================================================
// Helper: Create test messages
// ============================================================

function createUserMessage(text: string): UIMessage {
  return { id: `u-${Date.now()}`, role: 'user', parts: [{ type: 'text', text }] };
}

function createToolMessage(toolName: string, output: unknown, toolCallId = 'tc-1'): UIMessage {
  return {
    id: `a-${toolCallId}`,
    role: 'assistant',
    parts: [{ type: 'dynamic-tool', toolName, toolCallId, input: {}, output } as any],
  };
}

// ============================================================
// Tests: Lifecycle always runs (Layer 2)
// ============================================================
describe('V2 compaction module semantics', () => {
  it('manageToolOutputLifecycle always runs (no enable flag needed)', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('Read', { content: 'x'.repeat(10000) }),
    ];
    // No enable flag - Layer 2 always runs
    const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it('manageToolOutputLifecycle respects keepRecentTurns', () => {
    // Use outputs just above the 200 char minimum for compression
    const largeOutput = 'x'.repeat(300);
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('Read', { content: largeOutput }, 'tc-1'),
      createUserMessage('Q2'),
      createToolMessage('Bash', { stdout: largeOutput }, 'tc-2'),
      createUserMessage('Q3'),
    ];
    // keepRecentTurns=2 means keep last 2 user turns (Q2 and Q3)
    // Tool output before Q2 (tc-1) should be compressed
    // Tool output after Q2 but before Q3 (tc-2) should NOT be compressed
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentTurns: 2 });
    // First tool output should be compressed (outside keepRecentTurns)
    expect((result.messages[1].parts[0] as any).output._compacted).toBe(true);
    // Last tool output should NOT be compressed (within keepRecentTurns)
    expect((result.messages[3].parts[0] as any).output._compacted).toBeUndefined();
  });

  it('protected tools are never compressed', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('MyTool', { data: 'x'.repeat(10000) }),
    ];
    const config = {
      ...DEFAULT_LIFECYCLE_CONFIG,
      keepRecentTurns: 0,
      protectedTools: new Set(['MyTool']),
    };
    const result = manageToolOutputLifecycle(messages, config);
    expect((result.messages[1].parts[0] as any).output._compacted).toBeUndefined();
  });

  it('mcp_ tools are compactable by default', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('mcp_server', { result: 'x'.repeat(10000) }),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentTurns: 0 });
    expect((result.messages[1].parts[0] as any).output._compacted).toBe(true);
  });

  it('connector_ tools are compactable by default', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('connector_api', { data: 'x'.repeat(10000) }),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentTurns: 0 });
    expect((result.messages[1].parts[0] as any).output._compacted).toBe(true);
  });
});
