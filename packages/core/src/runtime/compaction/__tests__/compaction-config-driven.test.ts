// ============================================================
// Compaction Config Driven Behavior Tests
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildBehaviorConfig } from '../../../config/behavior';
import { resolveAgentCompactionConfig } from '../../../api/app/resolve-agent-config';
import {
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_LIFECYCLE_CONFIG,
  DEFAULT_CONTEXT_WINDOW_CONFIG,
  type CompactionConfig,
  type LifecycleConfig,
  type ContextWindowConfig,
} from '../types';
import { manageToolOutputLifecycle } from '../lifecycle';
import type { UIMessage } from 'ai';

// ============================================================
// 1. resolveAgentCompactionConfig returns config
// ============================================================
describe('compaction config merge', () => {
  it('uses behavior defaults when no override provided', () => {
    const behavior = buildBehaviorConfig();
    const result = resolveAgentCompactionConfig(behavior);
    expect(result.lifecycle).toBeDefined();
    expect(result.contextWindow).toBeDefined();
    expect(result.lifecycle.keepRecentTurns).toBe(3);
    expect(result.contextWindow.triggerPercent).toBe(0.85);
  });

  it('config has correct structure', () => {
    const config: CompactionConfig = {
      lifecycle: {
        keepRecentTurns: 5,
        largeOutputThreshold: 10000,
        compactableTools: null,
        protectedTools: new Set(['MyTool']),
      },
      contextWindow: {
        triggerPercent: 0.9,
        targetPercent: 0.7,
        contextHintMessages: 3,
        incrementalSummary: false,
      },
    };
    expect(config.lifecycle.keepRecentTurns).toBe(5);
    expect(config.contextWindow.triggerPercent).toBe(0.9);
  });
});

// ============================================================
// 2. Lifecycle config defaults
// ============================================================
describe('lifecycle config defaults', () => {
  it('has correct default values', () => {
    expect(DEFAULT_LIFECYCLE_CONFIG.keepRecentTurns).toBe(3);
    expect(DEFAULT_LIFECYCLE_CONFIG.largeOutputThreshold).toBe(8000);
    expect(DEFAULT_LIFECYCLE_CONFIG.compactableTools).toBeNull();
    expect(DEFAULT_LIFECYCLE_CONFIG.protectedTools.size).toBe(0);
  });

  it('context window has correct defaults', () => {
    expect(DEFAULT_CONTEXT_WINDOW_CONFIG.triggerPercent).toBe(0.85);
    expect(DEFAULT_CONTEXT_WINDOW_CONFIG.targetPercent).toBe(0.60);
    expect(DEFAULT_CONTEXT_WINDOW_CONFIG.contextHintMessages).toBe(2);
    expect(DEFAULT_CONTEXT_WINDOW_CONFIG.incrementalSummary).toBe(true);
  });
});

// ============================================================
// 3. Config-driven lifecycle behavior
// ============================================================
describe('config-driven lifecycle behavior', () => {
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

  it('keepRecentTurns=0 compresses all tool outputs', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('Read', { content: 'x'.repeat(10000) }),
      createUserMessage('Q2'),
      createToolMessage('Bash', { stdout: 'y'.repeat(10000) }),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentTurns: 0 });
    expect(result.tokensFreed).toBeGreaterThan(0);
    expect((result.messages[1].parts[0] as any).output._compacted).toBe(true);
    expect((result.messages[3].parts[0] as any).output._compacted).toBe(true);
  });

  it('largeOutputThreshold triggers compression for big outputs', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('Read', { content: 'x'.repeat(5000) }),
    ];
    const config = { ...DEFAULT_LIFECYCLE_CONFIG, largeOutputThreshold: 1000 };
    const result = manageToolOutputLifecycle(messages, config);
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it('custom compactableTools limits which tools are compressed', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('Read', { content: 'x'.repeat(10000) }),
      createUserMessage('Q2'),
      createToolMessage('CustomTool', { data: 'y'.repeat(10000) }),
    ];
    const config = {
      ...DEFAULT_LIFECYCLE_CONFIG,
      keepRecentTurns: 0,
      compactableTools: new Set(['Read']),
    };
    const result = manageToolOutputLifecycle(messages, config);
    // Read should be compressed
    expect((result.messages[1].parts[0] as any).output._compacted).toBe(true);
    // CustomTool should NOT be compressed (not in compactableTools)
    expect((result.messages[3].parts[0] as any).output._compacted).toBeUndefined();
  });
});
