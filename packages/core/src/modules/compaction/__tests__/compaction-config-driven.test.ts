// ============================================================
// Compaction Config Driven Behavior Tests
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildBehaviorConfig } from '../../../services/config/behavior';
import { resolveAgentCompactionConfig } from '../../../composition/app/resolve-agent-config';
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
    expect(result.lifecycle.keepRecentSteps).toBe(3);
    expect(result.contextWindow.triggerPercent).toBe(0.85);
  });

  it('config has correct structure', () => {
    const config: CompactionConfig = {
      lifecycle: {
        keepRecentSteps: 5,
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
    expect(config.lifecycle.keepRecentSteps).toBe(5);
    expect(config.contextWindow.triggerPercent).toBe(0.9);
  });
});

// ============================================================
// 2. Lifecycle config defaults
// ============================================================
describe('lifecycle config defaults', () => {
  it('has correct default values', () => {
    expect(DEFAULT_LIFECYCLE_CONFIG.keepRecentSteps).toBe(3);
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
    return { id: `u-${Date.now()}`, role: 'user', content: [{ type: 'text', text }] } as unknown as UIMessage;
  }

  function createToolMessage(toolName: string, output: unknown, toolCallId = 'tc-1'): UIMessage {
    return {
      id: `a-${toolCallId}`,
      role: 'tool',
      content: [{ type: 'tool-result', toolName, toolCallId, output: { type: 'json', value: output } }],
    } as unknown as UIMessage;
  }

  function getResultItem(msg: UIMessage): any {
    return ((msg as unknown as Record<string, unknown>).content as any[])[0];
  }

  it('keepRecentSteps=0 compresses all tool outputs', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('read_file', { path: 'a.ts', content: 'x'.repeat(10000) }),
      createUserMessage('Q2'),
      createToolMessage('bash', { command: 'echo', stdout: 'y'.repeat(10000), exitCode: 0 }),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });
    expect(result.tokensFreed).toBeGreaterThan(0);
    expect(getResultItem(result.messages[1] as UIMessage)._compacted).toBe(true);
    expect(getResultItem(result.messages[3] as UIMessage)._compacted).toBe(true);
  });

  it('largeOutputThreshold triggers compression for big outputs', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('read_file', { path: 'a.ts', content: 'x'.repeat(5000) }),
    ];
    const config = { ...DEFAULT_LIFECYCLE_CONFIG, largeOutputThreshold: 1000 };
    const result = manageToolOutputLifecycle(messages, config);
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it('custom compactableTools limits which tools are compressed', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('read_file', { path: 'a.ts', content: 'x'.repeat(10000) }),
      createUserMessage('Q2'),
      createToolMessage('CustomTool', { data: 'y'.repeat(10000) }),
    ];
    const config = {
      ...DEFAULT_LIFECYCLE_CONFIG,
      keepRecentSteps: 0,
      compactableTools: new Set(['read_file']),
    };
    const result = manageToolOutputLifecycle(messages, config);
    // read_file should be compressed
    expect(getResultItem(result.messages[1] as UIMessage)._compacted).toBe(true);
    // CustomTool should NOT be compressed (not in compactableTools)
    expect(getResultItem(result.messages[3] as UIMessage)._compacted).toBeUndefined();
  });
});
