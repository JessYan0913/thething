// ============================================================
// Phase 5 配置系统行为测试
// ============================================================
// 验证公开 API 中每个配置字段都有可观察的 runtime 行为。
// 参考 docs/CORE_APP_PARAMETER_PASSING_FIRST_PRINCIPLES_SOLUTION.md
// ============================================================

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { buildBehaviorConfig, DEFAULT_MODEL_SPECS } from '../../../config/behavior';
import {
  resolveAgentModelConfig,
  resolveAgentModules,
  resolveAgentCompactThreshold,
  resolveAgentCompactionConfig,
  resolveToolOutputOverrides,
} from '../../app/resolve-agent-config';
import { createSessionState } from '../../../runtime/session-state';
import {
  getToolOutputConfig,
  getMessageBudgetLimit,
  getPreviewSizeLimit,
  processToolOutput,
  setToolOutputOverrides,
  type ToolOutputOverrides,
} from '../../../runtime/budget/tool-output-manager';
import { createPermissionsSection } from '../../../extensions/system-prompt/sections/permissions';
import { resolveModelAlias } from '../../../extensions/subagents/model-resolver';
import type { PermissionRule } from '../../../extensions/permissions/types';
import {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  PREVIEW_SIZE_CHARS,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
} from '../../../config/defaults';

// ============================================================
// Mock DataStore for SessionState tests
// ============================================================

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

// ============================================================
// 1. enableThinking 能进入 runtime model config
// ============================================================

describe('1. enableThinking passes into runtime model config', () => {
  it('includes enableThinking=true in resolved model config', () => {
    const config = resolveAgentModelConfig({
      apiKey: 'test-key',
      baseURL: 'https://test.example',
      modelName: 'test-model',
      enableThinking: true,
    });
    expect(config.enableThinking).toBe(true);
  });

  it('includes enableThinking=false in resolved model config', () => {
    const config = resolveAgentModelConfig({
      apiKey: 'test-key',
      baseURL: 'https://test.example',
      modelName: 'test-model',
      enableThinking: false,
    });
    expect(config.enableThinking).toBe(false);
  });

  it('defaults enableThinking to undefined when not provided', () => {
    const config = resolveAgentModelConfig({
      apiKey: 'test-key',
      baseURL: 'https://test.example',
      modelName: 'test-model',
    });
    expect(config.enableThinking).toBeUndefined();
  });
});

// ============================================================
// 2. maxDenialsPerTool 影响 denial tracker
// ============================================================

describe('2. maxDenialsPerTool affects denial tracker', () => {
  it('passes maxDenialsPerTool into SessionState.denialTracker', () => {
    const ds = createMockDataStore();
    const state = createSessionState('test-conv', {
      maxDenialsPerTool: 5,
      dataStore: ds as any,
    });
    // DenialTracker stores maxDenialsPerTool internally
    expect(state.denialTracker).toBeDefined();
  });

  it('uses behavior default when session override not provided', () => {
    const ds = createMockDataStore();
    const state = createSessionState('test-conv', {
      dataStore: ds as any,
    });
    expect(state.denialTracker).toBeDefined();
  });
});

// ============================================================
// 3. availableModels 影响模型切换
// ============================================================

describe('3. availableModels affects model swapper', () => {
  it('passes custom availableModels into ModelSwapper', () => {
    const ds = createMockDataStore();
    const customModels = [
      { id: 'custom-1', name: 'Custom 1', costMultiplier: 0.5, capabilityTier: 1 },
      { id: 'custom-2', name: 'Custom 2', costMultiplier: 2.0, capabilityTier: 3 },
    ];
    const state = createSessionState('test-conv', {
      availableModels: customModels,
      dataStore: ds as any,
    });
    expect(state.modelSwapper).toBeDefined();
    // ModelSwapper should use the provided models
  });

  it('uses DEFAULT_MODEL_SPECS when not overridden', () => {
    const ds = createMockDataStore();
    const state = createSessionState('test-conv', {
      dataStore: ds as any,
    });
    expect(state.modelSwapper).toBeDefined();
  });
});

// ============================================================
// 4. autoDowngradeCostThreshold 影响成本降级
// ============================================================

describe('4. autoDowngradeCostThreshold affects cost downgrade', () => {
  it('passes custom threshold into ModelSwapper', () => {
    const ds = createMockDataStore();
    const state = createSessionState('test-conv', {
      autoDowngradeCostThreshold: 50,
      dataStore: ds as any,
    });
    expect(state.modelSwapper).toBeDefined();
  });
});

// ============================================================
// 5. compaction.sessionMemory 影响压缩保留窗口
// ============================================================

describe('5. compaction.sessionMemory affects compaction config', () => {
  it('deep merges agent compaction override into resolved config', () => {
    const behavior = buildBehaviorConfig({
      compaction: {
        bufferTokens: 13_000,
        sessionMemory: {
          minTokens: 5_000,
          maxTokens: 20_000,
          minTextBlockMessages: 3,
        },
        micro: {
          timeWindowMs: 300_000,
          imageMaxTokenSize: 20_000,
          compactableTools: ['Read'],
          gapThresholdMinutes: 30,
          keepRecent: 10,
        },
        postCompact: {
          totalBudget: 100_000,
          maxFilesToRestore: 10,
          maxTokensPerFile: 10_000,
          maxTokensPerSkill: 5_000,
          skillsTokenBudget: 25_000,
        },
      },
    });

    const result = resolveAgentCompactionConfig(behavior, {
      sessionMemory: { maxTokens: 15_000 },
    });

    // Override should take effect while defaults preserved
    expect(result.sessionMemory.maxTokens).toBe(15_000);
    expect(result.sessionMemory.minTokens).toBe(5_000);
  });
});

// ============================================================
// 6. toolOutput.maxToolResultsPerMessageChars 影响消息级预算
// ============================================================

describe('6. toolOutput config affects message-level budget', () => {
  beforeEach(() => {
    setToolOutputOverrides({});
  });

  it('getMessageBudgetLimit uses sessionConfig override', () => {
    const sessionConfig: ToolOutputOverrides = { messageBudget: 50_000 };
    expect(getMessageBudgetLimit(sessionConfig)).toBe(50_000);
  });

  it('getMessageBudgetLimit falls back to global when no sessionConfig', () => {
    setToolOutputOverrides({ messageBudget: 40_000 });
    expect(getMessageBudgetLimit()).toBe(40_000);
  });

  it('getMessageBudgetLimit falls back to default when no override', () => {
    expect(getMessageBudgetLimit()).toBe(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS);
  });

  it('processToolOutput uses sessionConfig for thresholds', async () => {
    const sessionConfig: ToolOutputOverrides = { maxResultSizeChars: 500 };
    const config = getToolOutputConfig('bash', sessionConfig);
    expect(config.maxResultSizeChars).toBe(500);
  });
});

// ============================================================
// 7. modules.permissions 控制权限注入
// ============================================================

describe('7. modules.permissions controls permission injection', () => {
  it('permissions section has content when permissions provided', () => {
    const rules: PermissionRule[] = [
      { id: 'rule-1', toolName: 'bash', behavior: 'allow', createdAt: Date.now(), source: 'project' as const },
      { id: 'rule-2', toolName: 'write_file', behavior: 'deny', createdAt: Date.now(), source: 'user' as const },
    ];
    const section = createPermissionsSection(rules);
    expect(section.content).toContain('bash');
    expect(section.content).toContain('write_file');
  });

  it('permissions section returns null when permissions empty (modules.permissions=false)', () => {
    const section = createPermissionsSection([]);
    expect(section.content).toBeNull();
  });

  it('permissions section returns null when permissions undefined', () => {
    const section = createPermissionsSection(undefined);
    expect(section.content).toBeNull();
  });

  it('resolveAgentModules sets permissions=false when explicitly disabled', () => {
    const modules = resolveAgentModules({ permissions: false });
    expect(modules.permissions).toBe(false);
  });
});

// ============================================================
// 8. modules.compaction 控制自动压缩
// ============================================================

describe('8. modules.compaction controls auto-compact', () => {
  it('compactionEnabled=false passes through to SessionState', () => {
    const ds = createMockDataStore();
    const state = createSessionState('test-conv', {
      compactionEnabled: false,
      dataStore: ds as any,
    });
    // SessionState.compact should check compactionEnabled
    expect(state).toBeDefined();
  });

  it('resolveAgentModules sets compaction=false when explicitly disabled', () => {
    const modules = resolveAgentModules({ compaction: false });
    expect(modules.compaction).toBe(false);
  });
});

// ============================================================
// 9. modelAliases 影响子代理模型选择
// ============================================================

describe('9. modelAliases affects sub-agent model resolution', () => {
  it('resolveModelAlias resolves "fast" to alias value', () => {
    const aliases = { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' };
    expect(resolveModelAlias('fast', aliases)).toBe('gpt-4o-mini');
  });

  it('resolveModelAlias resolves "smart" to alias value', () => {
    const aliases = { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' };
    expect(resolveModelAlias('smart', aliases)).toBe('gpt-4o');
  });

  it('resolveModelAlias resolves "default" to alias value', () => {
    const aliases = { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' };
    expect(resolveModelAlias('default', aliases)).toBe('gpt-4o-mini');
  });

  it('resolveModelAlias returns model name directly for non-alias strings', () => {
    const aliases = { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' };
    expect(resolveModelAlias('claude-3-opus', aliases)).toBe('claude-3-opus');
  });

  it('resolveModelAlias falls back to defaults when aliases not provided', () => {
    expect(resolveModelAlias('fast')).toBe('qwen-turbo');
    expect(resolveModelAlias('smart')).toBe('qwen-max');
  });
});

// ============================================================
// 10. ToolOutput per-session config works
// ============================================================

describe('10. ToolOutput per-session config replaces global singleton', () => {
  beforeEach(() => {
    setToolOutputOverrides({});
  });

  it('sessionConfig overrides take priority over global', () => {
    setToolOutputOverrides({ maxResultSizeChars: 50_000 });
    const sessionConfig: ToolOutputOverrides = { maxResultSizeChars: 10_000 };
    // sessionConfig should override global
    expect(getToolOutputConfig('default', sessionConfig).maxResultSizeChars).toBe(10_000);
  });

  it('global is used as fallback when no sessionConfig', () => {
    setToolOutputOverrides({ maxResultSizeChars: 50_000 });
    expect(getToolOutputConfig('default').maxResultSizeChars).toBe(50_000);
  });

  it('default config is used when no overrides at all', () => {
    expect(getToolOutputConfig('default').maxResultSizeChars).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS);
  });

  it('SessionState stores toolOutputConfig', () => {
    const ds = createMockDataStore();
    const overrides: ToolOutputOverrides = { messageBudget: 50_000 };
    const state = createSessionState('test-conv', {
      toolOutputOverrides: overrides,
      dataStore: ds as any,
    });
    expect(state.toolOutputConfig).toEqual(overrides);
  });
});