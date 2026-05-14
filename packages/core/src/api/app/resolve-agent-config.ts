// ============================================================
// Agent Config Resolver
// ============================================================

import type { ModelProviderConfig } from '../../foundation/model';
import type { ToolOutputOverrides } from '../../runtime/budget/tool-output-manager';
import type { BehaviorConfig, CompactionConfig } from '../../config/behavior';
import { DEFAULT_MAX_RESULT_SIZE_CHARS, PREVIEW_SIZE_CHARS } from '../../config/defaults';
import type { CreateAgentOptions } from './types';
import type { ResolvedAgentConfig, AgentModules } from '../../runtime/agent/types';
import type { SessionStateOptions } from '../../runtime/session-state/types';

type AgentCompactionOptions = NonNullable<CreateAgentOptions['compaction']>;

export function resolveAgentModelConfig(model: CreateAgentOptions['model']): ModelProviderConfig {
  return {
    apiKey: model.apiKey,
    baseURL: model.baseURL,
    modelName: model.modelName,
    includeUsage: model.includeUsage ?? true,
    enableThinking: model.enableThinking,
  };
}

export function resolveAgentModules(modules?: CreateAgentOptions['modules']): AgentModules {
  return {
    skills: modules?.skills ?? true,
    mcps: modules?.mcps ?? true,
    memory: modules?.memory ?? true,
    connectors: modules?.connectors ?? true,
    permissions: modules?.permissions ?? true,
    compaction: modules?.compaction ?? true,
  };
}

export function resolveAgentCompactThreshold(
  behavior: BehaviorConfig,
  options?: {
    session?: CreateAgentOptions['session'];
    compaction?: AgentCompactionOptions;
  },
): number {
  return (
    options?.compaction?.threshold ??
    options?.session?.compactThreshold ??
    behavior.compactionThreshold
  );
}

export function resolveAgentCompactionConfig(
  behavior: BehaviorConfig,
  compaction?: AgentCompactionOptions,
): CompactionConfig {
  return {
    bufferTokens: compaction?.bufferTokens ?? behavior.compaction.bufferTokens,
    sessionMemory: {
      ...behavior.compaction.sessionMemory,
      ...compaction?.sessionMemory,
    },
    micro: {
      ...behavior.compaction.micro,
      ...compaction?.micro,
    },
    postCompact: {
      ...behavior.compaction.postCompact,
      ...compaction?.postCompact,
    },
  };
}

export function resolveToolOutputOverrides(
  toolOutput: BehaviorConfig['toolOutput'],
): ToolOutputOverrides {
  return {
    ...(toolOutput.maxResultSizeChars !== DEFAULT_MAX_RESULT_SIZE_CHARS
      ? { maxResultSizeChars: toolOutput.maxResultSizeChars }
      : {}),
    maxToolResultTokens: toolOutput.maxToolResultTokens,
    messageBudget: toolOutput.maxToolResultsPerMessageChars,
    ...(toolOutput.previewSizeChars !== PREVIEW_SIZE_CHARS
      ? { previewSizeChars: toolOutput.previewSizeChars }
      : {}),
  };
}

// ============================================================
// resolveAgentConfig - 统一配置解析入口
// ============================================================
// 把 CreateAgentOptions + BehaviorConfig 收敛成一份 ResolvedAgentConfig，
// sessionOptions 在此完整组装，下游不再手写白名单截断。

export function resolveAgentConfig(options: CreateAgentOptions): ResolvedAgentConfig {
  const { context } = options;
  const { behavior } = context;

  const modules = resolveAgentModules(options.modules);
  const modelConfig = resolveAgentModelConfig(options.model);
  const compactionConfig = resolveAgentCompactionConfig(behavior, options.compaction);
  const compactThreshold = resolveAgentCompactThreshold(behavior, {
    session: options.session,
    compaction: options.compaction,
  });
  const toolOutputOverrides = resolveToolOutputOverrides(behavior.toolOutput);

  // sessionOptions 在此完整组装 — 下游直接消费，不再逐字段重建
  const sessionOptions: SessionStateOptions = {
    projectDir: context.cwd,
    maxContextTokens: options.session?.maxContextTokens ?? behavior.maxContextTokens,
    maxBudgetUsd: options.session?.maxBudgetUsd ?? behavior.maxBudgetUsdPerSession,
    compactThreshold,
    maxDenialsPerTool: options.session?.maxDenialsPerTool ?? behavior.maxDenialsPerTool,
    model: options.model.modelName,
    dataStore: context.runtime.dataStore,
    availableModels: behavior.availableModels,
    autoDowngradeCostThreshold: behavior.autoDowngradeCostThreshold,
    compactionConfig,
    compactionEnabled: modules.compaction,
    toolOutputOverrides,
  };

  return {
    modelConfig,
    modules,
    sessionOptions,
    behavior,
    layout: context.layout,
    toolOutputOverrides,
  };
}