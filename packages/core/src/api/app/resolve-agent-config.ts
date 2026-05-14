// ============================================================
// Agent Config Resolver
// ============================================================

import type { ModelProviderConfig } from '../../foundation/model';
import type { ToolOutputOverrides } from '../../runtime/budget/tool-output-manager';
import type { BehaviorConfig, CompactionConfig } from '../../config/behavior';
import { DEFAULT_MAX_RESULT_SIZE_CHARS, PREVIEW_SIZE_CHARS } from '../../config/defaults';
import type { CreateAgentOptions } from './types';

type AgentCompactionOptions = NonNullable<CreateAgentOptions['compaction']>;
type AgentModules = Required<NonNullable<CreateAgentOptions['modules']>>;

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
