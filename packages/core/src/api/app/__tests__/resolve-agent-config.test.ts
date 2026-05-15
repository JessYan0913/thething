import { describe, expect, it, vi } from 'vitest';
import { buildBehaviorConfig } from '../../../config/behavior';
import { resolveLayout } from '../../../config/layout';
import {
  resolveAgentCompactThreshold,
  resolveAgentCompactionConfig,
  resolveAgentConfig,
  resolveAgentModelConfig,
  resolveAgentModules,
  resolveToolOutputConfig,
} from '../resolve-agent-config';
import type { CreateAgentOptions } from '../types';
import type { PermissionRule } from '../../../extensions/permissions/types';

function createMockContext(overrides?: {
  behavior?: Parameters<typeof buildBehaviorConfig>[0];
  permissions?: PermissionRule[];
}) {
  const layout = resolveLayout({
    resourceRoot: '/tmp/test-project',
    dataDir: '/tmp/test-data',
    contextFileNames: ['THING.md'],
  });
  const behavior = buildBehaviorConfig(overrides?.behavior);
  const permissions = overrides?.permissions ?? [];

  const runtime = {
    layout,
    behavior,
    dataStore: {
      costStore: { saveCostRecord: vi.fn(), getCostRecords: vi.fn().mockResolvedValue([]), getTotalCost: vi.fn().mockResolvedValue(0) },
      summaryStore: { saveSummary: vi.fn(), getSummaryByConversation: vi.fn().mockReturnValue(null) },
      messageStore: { saveMessages: vi.fn(), getMessages: vi.fn().mockResolvedValue([]) },
      conversationStore: { saveConversation: vi.fn(), getConversation: vi.fn().mockResolvedValue(null), updateConversationTitle: vi.fn() },
    },
    connectorRegistry: {} as any,
    connectorRuntime: {} as any,
    connectorInbound: {} as any,
    dispose: vi.fn(),
  } as any;

  return {
    runtime,
    layout,
    behavior,
    skills: [],
    agents: [],
    mcps: [],
    connectors: [],
    permissions,
    memory: [],
    loadedFrom: {
      skills: { path: '', source: 'project' as const, count: 0 },
      agents: { path: '', source: 'project' as const, count: 0 },
      mcps: { path: '', source: 'project' as const, count: 0 },
      connectors: { path: '', source: 'project' as const, count: 0 },
      permissions: { userPath: '', userCount: 0, projectPath: '', projectCount: 0 },
      memory: { path: '', count: 0 },
    },
    reload: vi.fn(),
  };
}

function createBaseOptions(overrides?: Partial<CreateAgentOptions>): CreateAgentOptions {
  return {
    context: createMockContext(),
    conversationId: 'test-conv-1',
    model: {
      apiKey: 'test-key',
      baseURL: 'https://test.example',
      modelName: 'qwen-max',
    },
    ...overrides,
  };
}

describe('resolve-agent-config helpers', () => {
  it('passes enableThinking into runtime model config', () => {
    expect(resolveAgentModelConfig({
      apiKey: 'key',
      baseURL: 'https://example.test',
      modelName: 'qwen-max',
      enableThinking: true,
    })).toMatchObject({
      modelName: 'qwen-max',
      includeUsage: true,
      enableThinking: true,
    });
  });

  it('deep-merges CreateAgentOptions.compaction over behavior.compaction', () => {
    const behavior = buildBehaviorConfig({
      compaction: {
        bufferTokens: 13_000,
        sessionMemory: { minTokens: 10_000, maxTokens: 40_000, minTextBlockMessages: 5 },
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
      sessionMemory: { maxTokens: 12_000 },
      micro: { keepRecent: 2 },
      postCompact: { skillsTokenBudget: 8_000 },
    });

    expect(result.sessionMemory).toEqual({
      minTokens: 10_000,
      maxTokens: 12_000,
      minTextBlockMessages: 5,
    });
    expect(result.micro.keepRecent).toBe(2);
    expect(result.postCompact.skillsTokenBudget).toBe(8_000);
  });

  it('gives compaction.threshold precedence over legacy session.compactThreshold', () => {
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

  it('maps behavior.toolOutput to runtime ToolOutputConfig', () => {
    const behavior = buildBehaviorConfig({
      toolOutput: {
        maxResultSizeChars: 12_000,
        maxToolResultTokens: 5_000,
        maxToolResultsPerMessageChars: 24_000,
        previewSizeChars: 800,
      },
    });

    expect(resolveToolOutputConfig(behavior.toolOutput)).toEqual({
      maxResultSizeChars: 12_000,
      maxResultTokens: 5_000,
      messageBudget: 24_000,
      previewSizeChars: 800,
    });
  });
});

describe('resolveAgentConfig', () => {
  it('assembles a session snapshot without old toolOutput/project aliases', () => {
    const permissions: PermissionRule[] = [
      { id: 'rule-1', toolName: 'bash', behavior: 'ask', createdAt: Date.now(), source: 'project' },
    ];
    const context = createMockContext({
      behavior: {
        modelAliases: { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' },
        extraSensitivePaths: ['/secrets'],
      },
      permissions,
    });

    const resolved = resolveAgentConfig({
      context,
      conversationId: 'test-conv',
      model: { apiKey: 'key', baseURL: 'url', modelName: 'gpt-4o' },
      modules: { compaction: false },
    });

    expect(resolved.sessionOptions.projectRoot).toBe('/tmp/test-project');
    expect(resolved.sessionOptions.layout).toBe(context.layout);
    expect(resolved.sessionOptions.toolOutputConfig).toEqual(resolved.toolOutputConfig);
    expect(resolved.sessionOptions.modelAliases).toEqual(context.behavior.modelAliases);
    expect(resolved.sessionOptions.permissionRules).toEqual(permissions);
    expect(resolved.sessionOptions.extraSensitivePaths).toEqual(['/secrets']);
    expect(resolved.sessionOptions.compactionEnabled).toBe(false);
    expect((resolved.sessionOptions as unknown as Record<string, unknown>).projectDir).toBeUndefined();
    expect((resolved.sessionOptions as unknown as Record<string, unknown>).toolOutputOverrides).toBeUndefined();
  });

  it('preserves behavior-driven defaults on the resolved config', () => {
    const resolved = resolveAgentConfig(createBaseOptions());

    expect(resolved.behavior).toHaveProperty('maxStepsPerSession');
    expect(resolved.behavior).toHaveProperty('modelAliases');
    expect(resolved.behavior).toHaveProperty('toolOutput');
    expect(resolved.layout.resourceRoot).toBe('/tmp/test-project');
    expect(resolved.layout.dataDir).toBe('/tmp/test-data');
  });
});
