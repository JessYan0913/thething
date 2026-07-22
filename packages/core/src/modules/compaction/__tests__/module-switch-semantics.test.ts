// ============================================================
// Module Switch Semantics Tests
// ============================================================
// Tests that the compaction module respects the compactionEnabled flag

import { describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';
import type { ModelMessage } from 'ai';

import { manageToolOutputLifecycle } from '../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types';

// ============================================================
// Helper: Create test messages (ModelMessage 格式,与流水线一致)
// ============================================================

function createUserMessage(text: string): ModelMessage {
  return { id: `u-${Date.now()}`, role: 'user', content: [{ type: 'text', text }] } as unknown as ModelMessage;
}

function createToolMessage(toolName: string, output: unknown, toolCallId = 'tc-1'): ModelMessage {
  return {
    id: `a-${toolCallId}`,
    role: 'tool',
    content: [{ type: 'tool-result', toolName, toolCallId, output: { type: 'json', value: output } }],
  } as unknown as ModelMessage;
}

function getResultItem(msg: ModelMessage): any {
  return ((msg as unknown as Record<string, unknown>).content as any[])[0];
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

  it('manageToolOutputLifecycle respects keepRecentSteps', () => {
    // Use outputs just above the 200 char minimum for compression
    const largeOutput = 'x'.repeat(300);
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('Read', { content: largeOutput }, 'tc-1'),
      createUserMessage('Q2'),
      createToolMessage('Bash', { stdout: largeOutput }, 'tc-2'),
      createUserMessage('Q3'),
    ];
    // keepRecentSteps=1 means keep the last 1 tool-result message (tc-2)
    // Earlier tool output (tc-1) should be compressed
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 1 });
    // First tool output should be compressed (outside keepRecentSteps)
    expect(getResultItem(result.messages[1])._compacted).toBe(true);
    // Last tool output should NOT be compressed (within keepRecentSteps)
    expect(getResultItem(result.messages[3])._compacted).toBeUndefined();
  });

  it('protected tools are never compressed', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('MyTool', { data: 'x'.repeat(10000) }),
    ];
    const config = {
      ...DEFAULT_LIFECYCLE_CONFIG,
      keepRecentSteps: 0,
      protectedTools: new Set(['MyTool']),
    };
    const result = manageToolOutputLifecycle(messages, config);
    expect(getResultItem(result.messages[1])._compacted).toBeUndefined();
  });

  it('mcp_ tools are compactable by default', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('mcp_server', { result: 'x'.repeat(10000) }),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    expect(getResultItem(result.messages[1])._compacted).toBe(true);
  });

  it('connector_ tools are compactable by default', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('connector_api', { data: 'x'.repeat(10000) }),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    expect(getResultItem(result.messages[1])._compacted).toBe(true);
  });
});
