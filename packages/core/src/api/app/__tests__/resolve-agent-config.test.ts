import { describe, expect, it } from 'vitest';
import { buildBehaviorConfig } from '../../../config/behavior';
import {
  resolveAgentCompactThreshold,
  resolveAgentCompactionConfig,
  resolveAgentModelConfig,
  resolveAgentModules,
  resolveToolOutputOverrides,
} from '../resolve-agent-config';

describe('resolve-agent-config', () => {
  it('passes model enableThinking into runtime model config', () => {
    const result = resolveAgentModelConfig({
      apiKey: 'key',
      baseURL: 'https://example.test',
      modelName: 'qwen-max',
      enableThinking: true,
    });

    expect(result).toMatchObject({
      apiKey: 'key',
      baseURL: 'https://example.test',
      modelName: 'qwen-max',
      includeUsage: true,
      enableThinking: true,
    });
  });

  it('deep merges CreateAgentOptions.compaction over BehaviorConfig.compaction', () => {
    const behavior = buildBehaviorConfig({
      compaction: {
        bufferTokens: 13_000,
        sessionMemory: {
          minTokens: 10_000,
          maxTokens: 40_000,
          minTextBlockMessages: 5,
        },
        micro: {
          timeWindowMs: 1_000,
          imageMaxTokenSize: 2_000,
          compactableTools: ['Read'],
          gapThresholdMinutes: 60,
          keepRecent: 5,
        },
        postCompact: {
          totalBudget: 50_000,
          maxFilesToRestore: 5,
          maxTokensPerFile: 5_000,
          maxTokensPerSkill: 5_000,
          skillsTokenBudget: 25_000,
        },
      },
    });

    const result = resolveAgentCompactionConfig(behavior, {
      sessionMemory: {
        maxTokens: 12_000,
      },
      micro: {
        keepRecent: 2,
      },
      postCompact: {
        skillsTokenBudget: 8_000,
      },
    });

    expect(result.sessionMemory).toEqual({
      minTokens: 10_000,
      maxTokens: 12_000,
      minTextBlockMessages: 5,
    });
    expect(result.micro.keepRecent).toBe(2);
    expect(result.micro.compactableTools).toEqual(['Read']);
    expect(result.postCompact).toMatchObject({
      maxTokensPerSkill: 5_000,
      skillsTokenBudget: 8_000,
    });
  });

  it('lets compaction.threshold override legacy session compactThreshold', () => {
    const behavior = buildBehaviorConfig({ compactionThreshold: 25_000 });

    expect(resolveAgentCompactThreshold(behavior)).toBe(25_000);
    expect(resolveAgentCompactThreshold(behavior, {
      session: { compactThreshold: 20_000 },
    })).toBe(20_000);
    expect(resolveAgentCompactThreshold(behavior, {
      session: { compactThreshold: 20_000 },
      compaction: { threshold: 15_000 },
    })).toBe(15_000);
  });

  it('resolves module flags with default enabled semantics', () => {
    expect(resolveAgentModules()).toEqual({
      skills: true,
      mcps: true,
      memory: true,
      connectors: true,
      permissions: true,
      compaction: true,
    });

    expect(resolveAgentModules({ permissions: false, compaction: false })).toMatchObject({
      permissions: false,
      compaction: false,
    });
  });

  it('maps BehaviorConfig.toolOutput to runtime overrides', () => {
    const behavior = buildBehaviorConfig({
      toolOutput: {
        maxResultSizeChars: 12_000,
        maxToolResultTokens: 5_000,
        maxToolResultsPerMessageChars: 24_000,
        previewSizeChars: 800,
      },
    });

    expect(resolveToolOutputOverrides(behavior.toolOutput)).toEqual({
      maxResultSizeChars: 12_000,
      maxToolResultTokens: 5_000,
      messageBudget: 24_000,
      previewSizeChars: 800,
    });
  });
});
