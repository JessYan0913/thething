// ============================================================
// resolve-agent-config Tests
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildBehaviorConfig } from '../../../config/behavior';
import {
  resolveAgentModelConfig,
  resolveAgentModules,
  resolveAgentCompactionConfig,
  resolveAgentCompactThreshold,
} from '../resolve-agent-config';

describe('resolve-agent-config helpers', () => {
  it('resolveAgentModelConfig passes through model fields', () => {
    const result = resolveAgentModelConfig({
      apiKey: 'test-key',
      baseURL: 'https://api.test.com',
      modelName: 'qwen-max',
    });
    expect(result).toEqual({
      apiKey: 'test-key',
      baseURL: 'https://api.test.com',
      modelName: 'qwen-max',
      includeUsage: true,
      enableThinking: undefined,
    });
  });

  it('resolveAgentModules defaults all to true', () => {
    const result = resolveAgentModules();
    expect(result).toEqual({
      skills: true,
      mcps: true,
      memory: true,
      connectors: true,
      permissions: true,
      compaction: true,
    });
  });

  it('resolveAgentModules respects explicit overrides', () => {
    const result = resolveAgentModules({
      skills: false,
      mcps: false,
    });
    expect(result.skills).toBe(false);
    expect(result.mcps).toBe(false);
    expect(result.memory).toBe(true);
  });

  it('resolveAgentCompactionConfig returns behavior defaults', () => {
    const behavior = buildBehaviorConfig();
    const result = resolveAgentCompactionConfig(behavior);
    expect(result.lifecycle).toBeDefined();
    expect(result.contextWindow).toBeDefined();
    expect(result.lifecycle.keepRecentTurns).toBe(3);
    expect(result.contextWindow.triggerPercent).toBe(0.85);
  });

  it('resolveAgentCompactThreshold uses behavior default', () => {
    const behavior = buildBehaviorConfig({ compactionThreshold: 25_000 });
    expect(resolveAgentCompactThreshold(behavior)).toBe(25_000);
  });

  it('resolveAgentCompactThreshold gives session override precedence', () => {
    const behavior = buildBehaviorConfig({ compactionThreshold: 25_000 });
    expect(resolveAgentCompactThreshold(behavior, {
      session: { compactThreshold: 20_000 },
    })).toBe(20_000);
  });
});
