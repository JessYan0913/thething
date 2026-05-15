import { describe, expect, it, vi } from 'vitest';
import { buildBehaviorConfig } from '../../../config/behavior';
import { resolveLayout } from '../../../config/layout';
import { resolveAgentConfig, resolveAgentModelConfig, resolveToolOutputConfig } from '../../app/resolve-agent-config';
import { createSessionState } from '../../../runtime/session-state';
import {
  getMessageBudgetLimit,
  getPreviewSizeLimit,
  getToolOutputConfig,
  processToolOutput,
  type ToolOutputConfig,
} from '../../../runtime/budget/tool-output-manager';
import { createPermissionsSection } from '../../../extensions/system-prompt/sections/permissions';
import { resolveModelAlias } from '../../../extensions/subagents/model-resolver';
import type { PermissionRule } from '../../../extensions/permissions/types';

function createMockLayout() {
  return resolveLayout({
    resourceRoot: '/tmp/test-project',
    dataDir: '/tmp/test-data',
    contextFileNames: ['THING.md'],
  });
}

function createMockDataStore() {
  return {
    costStore: {
      saveCostRecord: vi.fn(),
      getCostRecords: vi.fn().mockResolvedValue([]),
      getTotalCost: vi.fn().mockResolvedValue(0),
    },
    summaryStore: {
      saveSummary: vi.fn(),
      getSummaryByConversation: vi.fn().mockReturnValue(null),
    },
    messageStore: {
      saveMessages: vi.fn(),
      getMessages: vi.fn().mockResolvedValue([]),
    },
    conversationStore: {
      saveConversation: vi.fn(),
      getConversation: vi.fn().mockResolvedValue(null),
      updateConversationTitle: vi.fn(),
    },
  };
}

function createMockContext(behaviorOverrides?: Parameters<typeof buildBehaviorConfig>[0]) {
  const layout = createMockLayout();
  const behavior = buildBehaviorConfig(behaviorOverrides);
  return {
    runtime: {
      layout,
      behavior,
      dataStore: createMockDataStore() as any,
      connectorRegistry: {} as any,
      connectorRuntime: {} as any,
      connectorInbound: {} as any,
      dispose: vi.fn(),
    },
    layout,
    behavior,
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
    reload: vi.fn(),
  };
}

describe('config parameter passing', () => {
  it('passes enableThinking into resolved model config', () => {
    expect(resolveAgentModelConfig({
      apiKey: 'test-key',
      baseURL: 'https://test.example',
      modelName: 'test-model',
      enableThinking: true,
    }).enableThinking).toBe(true);
  });

  it('pushes behavior-driven session settings into SessionState', () => {
    const layout = createMockLayout();
    const state = createSessionState('test-conv', {
      layout,
      projectRoot: layout.resourceRoot,
      toolOutputConfig: { maxResultSizeChars: 10_000, messageBudget: 50_000 },
      modelAliases: { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' },
      availableModels: [
        { id: 'custom-1', name: 'Custom 1', costMultiplier: 0.5, capabilityTier: 1 },
      ],
      autoDowngradeCostThreshold: 50,
      maxDenialsPerTool: 5,
      dataStore: createMockDataStore() as any,
    });

    expect(state.modelSwapper).toBeDefined();
    expect(state.denialTracker).toBeDefined();
    expect(state.toolOutputConfig).toEqual({
      maxResultSizeChars: 10_000,
      messageBudget: 50_000,
    });
  });

  it('maps behavior.toolOutput to runtime ToolOutputConfig and sessionOptions', () => {
    const context = createMockContext({
      toolOutput: {
        maxResultSizeChars: 12_000,
        maxToolResultTokens: 5_000,
        maxToolResultsPerMessageChars: 24_000,
        previewSizeChars: 800,
      },
      modelAliases: { fast: 'fast-x', smart: 'smart-x', default: 'default-x' },
    });

    const resolved = resolveAgentConfig({
      context,
      conversationId: 'test-conv',
      model: { apiKey: 'k', baseURL: 'u', modelName: 'm' },
    });

    expect(resolveToolOutputConfig(context.behavior.toolOutput)).toEqual({
      maxResultSizeChars: 12_000,
      maxResultTokens: 5_000,
      messageBudget: 24_000,
      previewSizeChars: 800,
    });
    expect(resolved.sessionOptions.toolOutputConfig).toEqual(resolved.toolOutputConfig);
    expect(resolved.sessionOptions.modelAliases).toEqual(context.behavior.modelAliases);
  });

  it('uses session-specific tool output config without global fallback', async () => {
    const sessionConfig: ToolOutputConfig = {
      maxResultSizeChars: 500,
      maxResultTokens: 10,
      messageBudget: 50_000,
      previewSizeChars: 256,
    };

    expect(getToolOutputConfig('bash', sessionConfig).maxResultSizeChars).toBe(500);
    expect(getMessageBudgetLimit(sessionConfig)).toBe(50_000);
    expect(getPreviewSizeLimit(sessionConfig)).toBe(256);
    expect(getMessageBudgetLimit()).not.toBe(50_000);

    const result = await processToolOutput('a'.repeat(100), 'bash', 'tool-token-limit', {
      sessionId: 'test-session',
      dataDir: '/tmp/test-data',
      config: sessionConfig,
    });
    expect(result.persisted).toBe(true);
  });

  it('keeps permissions prompt injection separate from runtime enforcement', () => {
    const rules: PermissionRule[] = [
      { id: 'rule-1', toolName: 'bash', behavior: 'allow', createdAt: Date.now(), source: 'project' },
      { id: 'rule-2', toolName: 'write_file', behavior: 'deny', createdAt: Date.now(), source: 'user' },
    ];

    expect(createPermissionsSection(rules).content).toContain('bash');
    expect(createPermissionsSection([]).content).toBeNull();
  });

  it('resolves model aliases from behavior defaults or explicit aliases', () => {
    expect(resolveModelAlias('fast')).toBe('qwen-turbo');
    expect(resolveModelAlias('smart', {
      fast: 'gpt-4o-mini',
      smart: 'gpt-4o',
      default: 'gpt-4o-mini',
    })).toBe('gpt-4o');
  });
});
