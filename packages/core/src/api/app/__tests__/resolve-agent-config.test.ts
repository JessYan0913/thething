import { describe, expect, it } from 'vitest';
import { buildBehaviorConfig } from '../../../config/behavior';
import {
  resolveAgentCompactThreshold,
  resolveAgentCompactionConfig,
  resolveAgentModelConfig,
  resolveAgentModules,
  resolveToolOutputOverrides,
  resolveAgentConfig,
} from '../resolve-agent-config';
import type { CreateAgentOptions } from '../types';
import type { ResolvedLayout } from '../../../config/layout';
import { vi } from 'vitest';

// ============================================================
// Helper: build a minimal CreateAgentOptions + mock context
// ============================================================

function createMockContext(behaviorOverrides?: Record<string, any>) {
  const behavior = buildBehaviorConfig(behaviorOverrides);
  const layout: ResolvedLayout = {
    resourceRoot: '/tmp/test-project',
    configDirName: '.thething',
    dataDir: '/tmp/test-data',
    resources: {
      skills: ['/tmp/test-project/.thething/skills', '/tmp/test-user/.thething/skills'],
      agents: ['/tmp/test-project/.thething/agents', '/tmp/test-user/.thething/agents'],
      mcps: ['/tmp/test-project/.thething/mcps', '/tmp/test-user/.thething/mcps'],
      connectors: ['/tmp/test-project/.thething/connectors', '/tmp/test-user/.thething/connectors'],
      permissions: ['/tmp/test-project/.thething/permissions', '/tmp/test-user/.thething/permissions'],
      memory: ['/tmp/test-project/.thething/memory', '/tmp/test-user/.thething/memory'],
    },
    contextFileNames: ['THING.md'],
    tokenizerCacheDir: '/tmp/test-data/tokenizer-cache',
    filenames: {
      permissions: 'permissions.json',
      db: 'thething.db',
    },
  };

  const mockRuntime = {
    layout,
    behavior,
    dataStore: {
      costStore: { saveCostRecord: vi.fn(), getCostRecords: vi.fn().mockResolvedValue([]), getTotalCost: vi.fn().mockResolvedValue(0) },
      summaryStore: { saveSummary: vi.fn(), getSummaryByConversation: vi.fn().mockReturnValue(null) },
      messageStore: { saveMessages: vi.fn(), getMessages: vi.fn().mockResolvedValue([]) },
      conversationStore: { saveConversation: vi.fn(), getConversation: vi.fn().mockResolvedValue(null), updateConversationTitle: vi.fn() },
    } as any,
    connectorRegistry: {} as any,
    connectorRuntime: {} as any,
    connectorInbound: {} as any,
    dispose: vi.fn(),
  };

  const context = {
    runtime: mockRuntime,
    layout,
    behavior,
    cwd: '/tmp/test-project',
    dataDir: '/tmp/test-data',
    skills: [],
    agents: [],
    mcps: [],
    connectors: [],
    permissions: [],
    memory: [],
    loadedFrom: {
      skills: { path: '', source: 'project' as const, count: 0 },
      agents: { path: '', source: 'project' as const, count: 0 },
      mcps: { path: '', source: 'project' as const, count: 0 },
      connectors: { path: '', source: 'project' as const, count: 0 },
      permissions: { userPath: '', userCount: 0, projectPath: '', projectCount: 0 },
      memory: { path: '', count: 0 },
    },
    errors: undefined,
    reload: vi.fn(),
  };

  return { context, behavior, layout, mockRuntime };
}

function createBaseOptions(overrides?: Partial<CreateAgentOptions>): CreateAgentOptions {
  const { context } = createMockContext();
  return {
    context,
    conversationId: 'test-conv-1',
    model: {
      apiKey: 'test-key',
      baseURL: 'https://test.example',
      modelName: 'qwen-max',
    },
    ...overrides,
  };
}

// ============================================================
// Individual resolver tests (existing)
// ============================================================

describe('resolve-agent-config (individual resolvers)', () => {
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

// ============================================================
// Unified resolveAgentConfig tests — acceptance criteria
// ============================================================

describe('resolveAgentConfig (unified)', () => {
  // AC1: enableThinking 能进入最终模型配置，并可被测试直接断言
  it('AC1: enableThinking reaches resolvedConfig.modelConfig', () => {
    const resolved = resolveAgentConfig(createBaseOptions({
      model: {
        apiKey: 'test-key',
        baseURL: 'https://test.example',
        modelName: 'qwen-max',
        enableThinking: true,
      },
    }));

    expect(resolved.modelConfig.enableThinking).toBe(true);
  });

  it('AC1: enableThinking=false also reaches resolvedConfig.modelConfig', () => {
    const resolved = resolveAgentConfig(createBaseOptions({
      model: {
        apiKey: 'test-key',
        baseURL: 'https://test.example',
        modelName: 'qwen-max',
        enableThinking: false,
      },
    }));

    expect(resolved.modelConfig.enableThinking).toBe(false);
  });

  // AC2: sessionOptions 不再被中间层白名单重建丢字段
  it('AC2: sessionOptions is fully assembled — no whitelist reconstruction needed', () => {
    const resolved = resolveAgentConfig(createBaseOptions({
      session: {
        maxContextTokens: 200_000,
        maxBudgetUsd: 10.0,
        maxDenialsPerTool: 7,
        compactThreshold: 30_000,
      },
    }));

    // All session overrides are present in sessionOptions
    expect(resolved.sessionOptions.maxContextTokens).toBe(200_000);
    expect(resolved.sessionOptions.maxBudgetUsd).toBe(10.0);
    expect(resolved.sessionOptions.maxDenialsPerTool).toBe(7);
    expect(resolved.sessionOptions.compactThreshold).toBe(30_000);

    // Behavior defaults also present
    expect(resolved.sessionOptions.dataStore).toBeDefined();
    expect(resolved.sessionOptions.model).toBe('qwen-max');
    expect(resolved.sessionOptions.compactionEnabled).toBe(true);
    expect(resolved.sessionOptions.toolOutputOverrides).toBeDefined();
  });

  // AC3: availableModels, autoDowngradeCostThreshold, maxDenialsPerTool 能到达 runtime 消费点
  it('AC3: availableModels reaches resolvedConfig.sessionOptions', () => {
    const customModels = [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', costMultiplier: 0.1, capabilityTier: 1 },
      { id: 'gpt-4o', name: 'GPT-4o', costMultiplier: 1.0, capabilityTier: 3 },
    ];
    const { context } = createMockContext({ availableModels: customModels });
    const resolved = resolveAgentConfig({
      context,
      conversationId: 'test-conv',
      model: { apiKey: 'key', baseURL: 'url', modelName: 'gpt-4o' },
    });

    expect(resolved.sessionOptions.availableModels).toEqual(customModels);
    // Also accessible on behavior for direct consumption
    expect(resolved.behavior.availableModels).toEqual(customModels);
  });

  it('AC3: autoDowngradeCostThreshold reaches resolvedConfig.sessionOptions', () => {
    const { context } = createMockContext({ autoDowngradeCostThreshold: 50 });
    const resolved = resolveAgentConfig({
      context,
      conversationId: 'test-conv',
      model: { apiKey: 'key', baseURL: 'url', modelName: 'gpt-4o' },
    });

    expect(resolved.sessionOptions.autoDowngradeCostThreshold).toBe(50);
    expect(resolved.behavior.autoDowngradeCostThreshold).toBe(50);
  });

  it('AC3: maxDenialsPerTool reaches resolvedConfig.sessionOptions', () => {
    const resolved = resolveAgentConfig(createBaseOptions({
      session: { maxDenialsPerTool: 5 },
    }));

    expect(resolved.sessionOptions.maxDenialsPerTool).toBe(5);
  });

  it('AC3: maxDenialsPerTool falls back to behavior default', () => {
    const resolved = resolveAgentConfig(createBaseOptions());

    // Default from buildBehaviorConfig
    expect(resolved.sessionOptions.maxDenialsPerTool).toBe(3);
  });

  // AC4: 公开配置新增字段时，不需要在多层对象里重复补拷贝逻辑
  // This is an architectural guarantee — verify that resolvedConfig contains
  // the complete BehaviorConfig so new fields automatically flow through
  it('AC4: resolvedConfig.behavior contains full BehaviorConfig — new fields auto-flow', () => {
    const resolved = resolveAgentConfig(createBaseOptions());

    // Verify that the full BehaviorConfig is available on resolvedConfig
    // so any new field added to BehaviorConfig is automatically accessible
    expect(resolved.behavior).toHaveProperty('maxStepsPerSession');
    expect(resolved.behavior).toHaveProperty('maxBudgetUsdPerSession');
    expect(resolved.behavior).toHaveProperty('maxContextTokens');
    expect(resolved.behavior).toHaveProperty('compactionThreshold');
    expect(resolved.behavior).toHaveProperty('maxDenialsPerTool');
    expect(resolved.behavior).toHaveProperty('availableModels');
    expect(resolved.behavior).toHaveProperty('modelAliases');
    expect(resolved.behavior).toHaveProperty('autoDowngradeCostThreshold');
    expect(resolved.behavior).toHaveProperty('compaction');
    expect(resolved.behavior).toHaveProperty('toolOutput');
    expect(resolved.behavior).toHaveProperty('memory');
    expect(resolved.behavior).toHaveProperty('extraSensitivePaths');
  });

  it('compaction config is deep-merged and available on sessionOptions', () => {
    const resolved = resolveAgentConfig(createBaseOptions({
      compaction: {
        sessionMemory: { maxTokens: 15_000 },
        micro: { keepRecent: 2 },
      },
    }));

    expect(resolved.sessionOptions.compactionConfig!.sessionMemory.maxTokens).toBe(15_000);
    expect(resolved.sessionOptions.compactionConfig!.micro.keepRecent).toBe(2);
    // Defaults preserved
    expect(resolved.sessionOptions.compactionConfig!.bufferTokens).toBeDefined();
  });

  it('modules flags affect sessionOptions.compactionEnabled', () => {
    const resolved = resolveAgentConfig(createBaseOptions({
      modules: { compaction: false },
    }));

    expect(resolved.modules.compaction).toBe(false);
    expect(resolved.sessionOptions.compactionEnabled).toBe(false);
  });

  it('toolOutputOverrides is accessible on resolvedConfig directly', () => {
    const resolved = resolveAgentConfig(createBaseOptions());

    expect(resolved.toolOutputOverrides).toBeDefined();
    expect(resolved.toolOutputOverrides.maxToolResultTokens).toBeDefined();
    expect(resolved.sessionOptions.toolOutputOverrides).toEqual(resolved.toolOutputOverrides);
  });

  it('layout is accessible on resolvedConfig for runtime consumption', () => {
    const resolved = resolveAgentConfig(createBaseOptions());

    expect(resolved.layout).toBeDefined();
    expect(resolved.layout.resourceRoot).toBe('/tmp/test-project');
    expect(resolved.layout.contextFileNames).toEqual(['THING.md']);
  });
});