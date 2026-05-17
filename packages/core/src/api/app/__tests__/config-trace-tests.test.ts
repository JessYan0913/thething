import { describe, expect, it, vi } from 'vitest';
import { buildBehaviorConfig, DEFAULT_MODEL_ALIASES, DEFAULT_MODEL_SPECS } from '../../../config/behavior';
import { resolveLayout } from '../../../config/layout';
import { createPricingResolver } from '../../../foundation/model/pricing';
import { resolveAgentConfig, traceResolvedAgentConfig } from '../../app/resolve-agent-config';
import type { CreateAgentOptions } from '../../app/types';

function createMockContext(behaviorOverrides?: Record<string, unknown>) {
  const behavior = buildBehaviorConfig(behaviorOverrides as Parameters<typeof buildBehaviorConfig>[0]);
  const layout = resolveLayout({
    resourceRoot: '/tmp/test-project',
    dataDir: '/tmp/test-data',
    contextFileNames: ['THING.md'],
  });

  return {
    runtime: {
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
        env: {},
        pricingResolver: createPricingResolver(),
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

describe('traceResolvedAgentConfig', () => {
  it('emits source/value/consumers for resolved fields', () => {
    const options = createBaseOptions();
    const resolved = resolveAgentConfig(options);
    const trace = traceResolvedAgentConfig(options, resolved);

    expect(trace.fields.length).toBeGreaterThan(0);
    expect(trace.formatted).toContain('modelConfig.modelName');
    for (const field of trace.fields) {
      expect(field.field).toBeTruthy();
      expect(field.source).toMatch(/^(explicit-override|behavior-default|resolved-default|layout-default)$/);
      expect(field.consumers.length).toBeGreaterThan(0);
    }
  });

  it('tracks explicit enableThinking and modules.permissions overrides', () => {
    const options = createBaseOptions({
      model: {
        apiKey: 'test-key',
        baseURL: 'https://test.example',
        modelName: 'qwen-max',
        enableThinking: true,
      },
      modules: { permissions: false },
    });
    const trace = traceResolvedAgentConfig(options, resolveAgentConfig(options));

    expect(trace.fields.find(field => field.field === 'modelConfig.enableThinking')?.source).toBe('explicit-override');
    expect(trace.fields.find(field => field.field === 'modules.permissions')?.source).toBe('explicit-override');
  });

  it('tracks sessionOptions.modelAliases and toolOutputConfig under the new names', () => {
    const context = createMockContext({
      modelAliases: { fast: 'fast-x', smart: 'smart-x', default: 'default-x' },
      toolOutput: {
        maxResultSizeChars: 12_000,
        maxToolResultTokens: 5_000,
        maxToolResultsPerMessageChars: 24_000,
        previewSizeChars: 800,
      },
    });
    const options: CreateAgentOptions = {
      context,
      conversationId: 'test-conv',
      model: { apiKey: 'k', baseURL: 'u', modelName: 'm' },
    };
    const resolved = resolveAgentConfig(options);
    const trace = traceResolvedAgentConfig(options, resolved);

    expect(resolved.sessionOptions.modelAliases).toEqual({
      fast: 'fast-x',
      smart: 'smart-x',
      default: 'default-x',
    });
    expect(resolved.toolOutputConfig).toEqual({
      maxResultSizeChars: 12_000,
      maxResultTokens: 5_000,
      messageBudget: 24_000,
      previewSizeChars: 800,
    });
    expect(trace.fields.find(field => field.field === 'sessionOptions.modelAliases.fast')?.consumers).toContain('agent-control/model-switching');
    expect(trace.fields.find(field => field.field === 'toolOutputConfig.maxResultTokens')).toBeDefined();
    expect(trace.fields.find(field => field.field === 'sessionOptions.toolOutputConfig.maxResultSizeChars')).toBeDefined();
  });

  it('keeps behavior and layout defaults visible on the resolved config', () => {
    const resolved = resolveAgentConfig(createBaseOptions());

    expect(resolved.behavior.availableModels).toEqual(DEFAULT_MODEL_SPECS);
    expect(resolved.behavior.modelAliases).toEqual(DEFAULT_MODEL_ALIASES);
    expect(resolved.layout.dataDir).toBe('/tmp/test-data');
    expect(resolved.layout.contextFileNames).toEqual(['THING.md']);
  });

  it('does not expose removed session aliases', () => {
    const resolved = resolveAgentConfig(createBaseOptions());
    const keys = Object.keys(resolved.sessionOptions);

    expect(keys).toContain('projectRoot');
    expect(keys).toContain('layout');
    expect(keys).toContain('toolOutputConfig');
    expect(keys).toContain('modelAliases');
    expect(keys).not.toContain('projectDir');
    expect(keys).not.toContain('toolOutputOverrides');
  });
});
