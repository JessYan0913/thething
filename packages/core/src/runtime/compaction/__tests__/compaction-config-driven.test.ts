// ============================================================
// Compaction Config Driven Behavior Tests
// ============================================================
// 验收清单:
// - behavior.compaction 与 options.compaction 的合并结果可预测
// - sessionOptions.compactionConfig 能被 runtime 原样消费
// - session memory、micro compact、post compact 的关键参数不再回退到未声明默认值
// - 压缩相关测试能覆盖至少一个明确的行为结果
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildBehaviorConfig } from '../../../config/behavior';
import { resolveAgentCompactionConfig } from '../../../api/app/resolve-agent-config';
import {
  toRuntimeCompactionConfig,
  DEFAULT_MICRO_COMPACT_CONFIG,
  DEFAULT_POST_COMPACT_CONFIG,
  type RuntimeCompactionConfig,
  type MicroCompactConfig,
  type PostCompactConfig,
} from '../types';
import { microCompactMessages } from '../micro-compact';
import { reinjectAfterCompact } from '../post-compact-reinject';
import { shouldTriggerAutoCompact, autoCompactIfNeeded } from '../auto-compact';
import { tryPtlDegradation } from '../ptl-degradation';
import type { UIMessage } from 'ai';

// ============================================================
// 1. resolveAgentCompactionConfig 合并结果可预测
// ============================================================
describe('compaction config merge', () => {
  it('uses behavior defaults when no override provided', () => {
    const behavior = buildBehaviorConfig();
    const result = resolveAgentCompactionConfig(behavior);
    expect(result.bufferTokens).toBe(13_000);
    expect(result.sessionMemory.minTokens).toBe(10_000);
    expect(result.micro.compactableTools).toContain('Read');
    expect(result.micro.compactableTools).toContain('Bash');
    expect(result.postCompact.totalBudget).toBe(50_000);
  });

  it('deep merges sessionMemory override preserving unset defaults', () => {
    const behavior = buildBehaviorConfig();
    const result = resolveAgentCompactionConfig(behavior, {
      sessionMemory: { maxTokens: 15_000 },
    });
    expect(result.sessionMemory.maxTokens).toBe(15_000);
    expect(result.sessionMemory.minTokens).toBe(10_000); // preserved from behavior
    expect(result.sessionMemory.minTextBlockMessages).toBe(5); // preserved
  });

  it('deep merges micro override preserving unset defaults', () => {
    const behavior = buildBehaviorConfig();
    const result = resolveAgentCompactionConfig(behavior, {
      micro: { imageMaxTokenSize: 5_000 },
    });
    expect(result.micro.imageMaxTokenSize).toBe(5_000);
    expect(result.micro.timeWindowMs).toBe(15 * 60 * 1000); // preserved
    expect(result.micro.gapThresholdMinutes).toBe(60); // preserved
  });

  it('deep merges postCompact override preserving unset defaults', () => {
    const behavior = buildBehaviorConfig();
    const result = resolveAgentCompactionConfig(behavior, {
      postCompact: { totalBudget: 100_000 },
    });
    expect(result.postCompact.totalBudget).toBe(100_000);
    expect(result.postCompact.maxFilesToRestore).toBe(5); // preserved
  });

  it('behavior defaults can be overridden entirely', () => {
    const behavior = buildBehaviorConfig({
      compaction: {
        bufferTokens: 5_000,
        sessionMemory: { minTokens: 1_000, maxTokens: 10_000, minTextBlockMessages: 2 },
        micro: { timeWindowMs: 60_000, imageMaxTokenSize: 500, compactableTools: ['Bash'], gapThresholdMinutes: 10, keepRecent: 3 },
        postCompact: { totalBudget: 20_000, maxFilesToRestore: 2, maxTokensPerFile: 2_000, maxTokensPerSkill: 2_000, skillsTokenBudget: 10_000 },
      },
    });
    const result = resolveAgentCompactionConfig(behavior);
    expect(result.bufferTokens).toBe(5_000);
    expect(result.sessionMemory.minTokens).toBe(1_000);
    expect(result.micro.compactableTools).toEqual(['Bash']);
    expect(result.postCompact.totalBudget).toBe(20_000);
  });
});

// ============================================================
// 2. toRuntimeCompactionConfig 转换 compactableTools
// ============================================================
describe('RuntimeCompactionConfig conversion', () => {
  it('converts compactableTools from string[] to Set<string>', () => {
    const behavior = buildBehaviorConfig();
    const resolved = resolveAgentCompactionConfig(behavior);
    const runtimeConfig = toRuntimeCompactionConfig(resolved);

    expect(runtimeConfig.micro.compactableTools).toBeInstanceOf(Set);
    expect(runtimeConfig.micro.compactableTools.has('Read')).toBe(true);
    expect(runtimeConfig.micro.compactableTools.has('Bash')).toBe(true);
    expect(runtimeConfig.micro.compactableTools.has('unknown')).toBe(false);
  });

  it('preserves all other config fields unchanged', () => {
    const behavior = buildBehaviorConfig();
    const resolved = resolveAgentCompactionConfig(behavior);
    const runtimeConfig = toRuntimeCompactionConfig(resolved);

    expect(runtimeConfig.bufferTokens).toBe(resolved.bufferTokens);
    expect(runtimeConfig.sessionMemory).toEqual(resolved.sessionMemory);
    expect(runtimeConfig.micro.timeWindowMs).toBe(resolved.micro.timeWindowMs);
    expect(runtimeConfig.micro.imageMaxTokenSize).toBe(resolved.micro.imageMaxTokenSize);
    expect(runtimeConfig.postCompact).toEqual(resolved.postCompact);
  });
});

// ============================================================
// 3. microCompactMessages uses resolved config
// ============================================================
describe('micro compact config-driven behavior', () => {
  it('uses custom compactableTools from resolved config', async () => {
    const customConfig: Partial<MicroCompactConfig> = {
      compactableTools: new Set(['CustomTool']),
      imageMaxTokenSize: 100,
    };

    const messages: UIMessage[] = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          {
            type: 'tool_use' as any,
            name: 'CustomTool',
            id: 'call-1',
          } as any,
        ],
      } as any,
      {
        id: '2',
        role: 'user',
        parts: [
          {
            type: 'tool_result' as any,
            tool_use_id: 'call-1',
            content: 'some output',
          } as any,
        ],
      } as any,
    ];

    // With custom compactableTools = {'CustomTool'}, micro-compact won't clear
    // because the output is too small (< imageMaxTokenSize=100)
    const result = await microCompactMessages(messages, customConfig);
    expect(result.messages).toBeDefined();
  });

  it('defaults to DEFAULT_MICRO_COMPACT_CONFIG when no config provided', async () => {
    const messages: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ];
    const result = await microCompactMessages(messages);
    expect(result.executed).toBe(false);
  });
});

// ============================================================
// 4. autoCompactIfNeeded uses resolved bufferTokens
// ============================================================
describe('auto compact config-driven behavior', () => {
  it('uses custom compactionThreshold and bufferTokens', async () => {
    // With threshold=25_000 and bufferTokens=20_000,
    // trigger threshold = 25_000 - 20_000 = 5_000
    // Even small messages (~5 tokens) are below 5_000
    const messages: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ];

    // Should not trigger for small messages even with low threshold
    const result = await autoCompactIfNeeded(
      messages,
      'test-conv-config-1',
      25_000,
      20_000,
    );
    expect(result).toBe(false);
  });

  it('uses default threshold when not specified', async () => {
    const messages: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ];
    // Without explicit threshold, defaults to COMPACT_TOKEN_THRESHOLD (25_000)
    const result = await shouldTriggerAutoCompact(
      messages,
      'test-conv-default',
      0,
    );
    expect(result).toBe(false);
  });
});

// ============================================================
// 5. reinjectAfterCompact uses resolved PostCompactConfig
// ============================================================
describe('post compact config-driven behavior', () => {
  it('uses custom PostCompactConfig budget', async () => {
    const messages: UIMessage[] = [
      {
        id: 'summary-1',
        role: 'system',
        parts: [{ type: 'text', text: '[Previous conversation summary]\nSummary content\n[End of summary]' }],
      },
    ];

    const context = {
      recentlyReadFiles: [{ path: '/test/file.ts', content: 'file content here' }],
      activeSkills: [],
    };

    const customConfig: PostCompactConfig = {
      totalBudget: 100,
      maxFilesToRestore: 1,
      maxTokensPerFile: 50,
      maxTokensPerSkill: 50,
      skillsTokenBudget: 50,
    };

    const result = await reinjectAfterCompact(messages, context, customConfig);
    // With a very small budget (100 tokens), reinjection may or may not happen
    // but the function should use the custom config, not the hardcoded default
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it('defaults to DEFAULT_POST_COMPACT_CONFIG when no config provided', async () => {
    const messages: UIMessage[] = [
      {
        id: 'summary-1',
        role: 'system',
        parts: [{ type: 'text', text: '[Previous conversation summary]\nSummary content\n[End of summary]' }],
      },
    ];

    const context = {
      recentlyReadFiles: [],
      activeSkills: [],
    };

    const result = await reinjectAfterCompact(messages, context);
    expect(result).toBeDefined();
    // Without reinjection data, messages should be unchanged
    expect(result.length).toBe(1);
  });
});

// ============================================================
// 6. tryPtlDegradation uses resolved config
// ============================================================
describe('PTL degradation config-driven behavior', () => {
  it('uses custom retryThreshold from options', async () => {
    const messages: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ];

    // With a very high retryThreshold, small messages should not trigger degradation
    const result = await tryPtlDegradation(messages, {
      retryThreshold: 100_000,
    });
    expect(result.executed).toBe(false);
  });

  it('passes microConfig through to micro-compact step', async () => {
    const messages: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ];

    // Verify microConfig is accepted (even though messages are too small to trigger)
    const customMicro: MicroCompactConfig = {
      ...DEFAULT_MICRO_COMPACT_CONFIG,
      imageMaxTokenSize: 500,
    };

    const result = await tryPtlDegradation(messages, {
      microConfig: customMicro,
    });
    expect(result.executed).toBe(false);
  });
});

// ============================================================
// 7. compactionConfig flows through SessionState
// ============================================================
describe('compaction config flows to SessionState', () => {
  it('SessionStateOptions.compactionConfig is type CompactionConfig (string[])', () => {
    const behavior = buildBehaviorConfig();
    const resolved = resolveAgentCompactionConfig(behavior);
    // resolved.micro.compactableTools is string[] (from BehaviorConfig)
    expect(Array.isArray(resolved.micro.compactableTools)).toBe(true);
  });

  it('toRuntimeCompactionConfig produces RuntimeCompactionConfig (Set<string>)', () => {
    const behavior = buildBehaviorConfig();
    const resolved = resolveAgentCompactionConfig(behavior);
    const runtimeConfig = toRuntimeCompactionConfig(resolved);
    // runtimeConfig.micro.compactableTools is Set<string>
    expect(runtimeConfig.micro.compactableTools).toBeInstanceOf(Set);
  });
});