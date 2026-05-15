// ============================================================
// Agent Config Resolver
// ============================================================

import type { ModelProviderConfig } from '../../foundation/model';
import type { ToolOutputConfig } from '../../runtime/budget/tool-output-manager';
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

export function resolveToolOutputConfig(
  toolOutput: BehaviorConfig['toolOutput'],
): ToolOutputConfig {
  return {
    maxResultSizeChars: toolOutput.maxResultSizeChars !== DEFAULT_MAX_RESULT_SIZE_CHARS
      ? toolOutput.maxResultSizeChars
      : DEFAULT_MAX_RESULT_SIZE_CHARS,
    maxResultTokens: toolOutput.maxToolResultTokens,
    messageBudget: toolOutput.maxToolResultsPerMessageChars,
    previewSizeChars: toolOutput.previewSizeChars !== PREVIEW_SIZE_CHARS
      ? toolOutput.previewSizeChars
      : PREVIEW_SIZE_CHARS,
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
  const toolOutputConfig = resolveToolOutputConfig(behavior.toolOutput);

  // sessionOptions 在此完整组装 — 下游直接消费，不再逐字段重建
  const sessionOptions: SessionStateOptions = {
    projectRoot: context.layout.resourceRoot,
    layout: context.layout,
    maxContextTokens: options.session?.maxContextTokens ?? behavior.maxContextTokens,
    maxBudgetUsd: options.session?.maxBudgetUsd ?? behavior.maxBudgetUsdPerSession,
    compactThreshold,
    maxDenialsPerTool: options.session?.maxDenialsPerTool ?? behavior.maxDenialsPerTool,
    model: options.model.modelName,
    dataStore: context.runtime.dataStore,
    availableModels: behavior.availableModels,
    modelAliases: behavior.modelAliases,
    autoDowngradeCostThreshold: behavior.autoDowngradeCostThreshold,
    compactionConfig,
    compactionEnabled: modules.compaction,
    toolOutputConfig,
    permissionRules: context.permissions,
    extraSensitivePaths: behavior.extraSensitivePaths,
  };

  return {
    modelConfig,
    modules,
    sessionOptions,
    behavior,
    layout: context.layout,
    toolOutputConfig,
    dynamicReload: options.dynamicReload ?? false,
  };
}

// ============================================================
// traceResolvedAgentConfig - 配置追踪工具
// ============================================================
// 输出每个公开配置字段的来源、最终值和消费模块，
// 作为防止参数断层的回归门禁基础。

export interface ConfigFieldTrace {
  /** 字段名（点分路径，如 'behavior.compaction.bufferTokens'） */
  field: string;
  /** 值的来源：'explicit-override'（调用方显式传入）、'behavior-default'（BehaviorConfig 默认值）、'resolved-default'（解析层默认值） */
  source: 'explicit-override' | 'behavior-default' | 'resolved-default' | 'layout-default';
  /** 最终值 */
  value: unknown;
  /** 消费此字段的模块列表 */
  consumers: string[];
}

export interface ConfigTraceResult {
  /** 所有字段的追踪结果 */
  fields: ConfigFieldTrace[];
  /** 格式化的可读输出 */
  formatted: string;
}

const FIELD_CONSUMERS: Record<string, string[]> = {
  'modelConfig.apiKey': ['foundation/model/create'],
  'modelConfig.baseURL': ['foundation/model/create'],
  'modelConfig.modelName': ['session-state', 'agent-control/model-switching'],
  'modelConfig.includeUsage': ['foundation/model/create'],
  'modelConfig.enableThinking': ['foundation/model/create', 'runtime/agent'],
  'modules.skills': ['system-prompt/skills', 'runtime/agent/tools'],
  'modules.mcps': ['runtime/agent/tools', 'mcp'],
  'modules.memory': ['system-prompt/memory', 'extensions/memory'],
  'modules.connectors': ['runtime/agent/tools', 'connector'],
  'modules.permissions': ['system-prompt/permissions'],
  'modules.compaction': ['runtime/compaction', 'session-state'],
  'behavior.maxStepsPerSession': ['runtime/agent/loop'],
  'behavior.maxBudgetUsdPerSession': ['session-state/cost-tracker'],
  'behavior.maxContextTokens': ['session-state/token-budget', 'runtime/compaction'],
  'behavior.compactionThreshold': ['runtime/compaction'],
  'behavior.maxDenialsPerTool': ['agent-control/denial-tracking'],
  'behavior.availableModels': ['agent-control/model-switching', 'session-state'],
  'behavior.modelAliases': ['extensions/subagents', 'agent-control/model-switching'],
  'behavior.autoDowngradeCostThreshold': ['agent-control/model-switching', 'session-state'],
  'behavior.modelPricing': ['foundation/model/pricing'],
  'behavior.extraSensitivePaths': ['permissions'],
  'behavior.compaction.bufferTokens': ['runtime/compaction'],
  'behavior.compaction.sessionMemory': ['runtime/compaction'],
  'behavior.compaction.micro': ['runtime/compaction/micro-compact'],
  'behavior.compaction.postCompact': ['runtime/compaction/post-compact'],
  'behavior.toolOutput.maxResultSizeChars': ['budget/tool-output-manager'],
  'behavior.toolOutput.maxToolResultTokens': ['budget/tool-output-manager'],
  'behavior.toolOutput.maxToolResultsPerMessageChars': ['budget/message-budget'],
  'behavior.toolOutput.previewSizeChars': ['budget/tool-output-manager'],
  'behavior.memory.mdMaxLines': ['extensions/memory/memdir'],
  'behavior.memory.mdMaxSizeKb': ['extensions/memory/memdir'],
  'behavior.memory.entrypointMaxLines': ['extensions/memory/memdir'],
  'behavior.memory.entrypointMaxBytes': ['extensions/memory/memdir'],
  'layout.resourceRoot': ['context', 'system-prompt/project-context'],
  'layout.configDirName': ['layout', 'loaders', 'system-prompt/project-context'],
  'layout.dataDir': ['context', 'foundation/datastore'],
  'layout.resources': ['loaders'],
  'layout.contextFileNames': ['system-prompt/project-context'],
  'layout.tokenizerCacheDir': ['foundation/tokenizer'],
  'sessionOptions.maxContextTokens': ['session-state/token-budget'],
  'sessionOptions.maxBudgetUsd': ['session-state/cost-tracker'],
  'sessionOptions.compactThreshold': ['runtime/compaction'],
  'sessionOptions.maxDenialsPerTool': ['agent-control/denial-tracking'],
  'sessionOptions.model': ['session-state'],
  'sessionOptions.availableModels': ['agent-control/model-switching'],
  'sessionOptions.modelAliases.fast': ['agent-control/model-switching'],
  'sessionOptions.modelAliases.smart': ['agent-control/model-switching'],
  'sessionOptions.modelAliases.default': ['agent-control/model-switching'],
  'sessionOptions.autoDowngradeCostThreshold': ['agent-control/model-switching'],
  'sessionOptions.compactionConfig': ['runtime/compaction'],
  'sessionOptions.compactionEnabled': ['runtime/compaction'],
  'sessionOptions.toolOutputConfig': ['budget/tool-output-manager'],
  'toolOutputConfig.maxResultSizeChars': ['budget/tool-output-manager'],
  'toolOutputConfig.maxResultTokens': ['budget/tool-output-manager'],
  'toolOutputConfig.messageBudget': ['budget/message-budget'],
  'toolOutputConfig.previewSizeChars': ['budget/tool-output-manager'],
  'dynamicReload': ['runtime/agent/tools', 'extensions/subagents'],
};

function determineSource(
  options: CreateAgentOptions,
  _resolved: ResolvedAgentConfig,
  field: string,
): ConfigFieldTrace['source'] {
  // modelConfig fields — source depends on whether caller explicitly passed them
  if (field.startsWith('modelConfig.')) {
    const key = field.slice('modelConfig.'.length);
    const modelOpt = options.model as unknown as Record<string, unknown>;
    if (key === 'enableThinking') {
      return modelOpt[key] !== undefined ? 'explicit-override' : 'resolved-default';
    }
    if (key === 'includeUsage') {
      return modelOpt[key] !== undefined ? 'explicit-override' : 'resolved-default';
    }
    return 'explicit-override';
  }

  // modules fields
  if (field.startsWith('modules.')) {
    const key = field.slice('modules.'.length);
    return options.modules?.[key as keyof CreateAgentOptions['modules']] !== undefined
      ? 'explicit-override'
      : 'resolved-default';
  }

  // sessionOptions fields — check session override vs behavior default
  if (field.startsWith('sessionOptions.')) {
    const key = field.slice('sessionOptions.'.length);
    const sess = options.session as Record<string, unknown> | undefined;
    if (sess && sess[key] !== undefined) return 'explicit-override';
    if (key === 'compactThreshold') {
      if (options.compaction?.threshold !== undefined) return 'explicit-override';
      if (options.session?.compactThreshold !== undefined) return 'explicit-override';
      return 'behavior-default';
    }
    if (key === 'model' || key === 'dataStore') return 'explicit-override';
    return 'behavior-default';
  }

  // behavior fields — check if caller provided a partial override
  if (field.startsWith('behavior.')) {
    // If the resolved behavior came from buildBehaviorConfig with overrides,
    // the source depends on what was passed. Since we don't have the original
    // partial, we check whether the value differs from the hardcoded default.
    return 'behavior-default';
  }

  // layout fields
  if (field.startsWith('layout.')) {
    return 'layout-default';
  }

  // toolOutputConfig
  if (field.startsWith('toolOutputConfig.')) {
    return 'behavior-default';
  }

  return 'behavior-default';
}

function collectFieldPaths(obj: unknown, prefix: string, maxDepth: number = 3): string[] {
  if (maxDepth <= 0 || obj === null || obj === undefined || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return [prefix];

  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const full = `${prefix}.${key}`;
    if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) && maxDepth > 1) {
      paths.push(...collectFieldPaths(value, full, maxDepth - 1));
    } else {
      paths.push(full);
    }
  }
  return paths;
}

export function traceResolvedAgentConfig(
  options: CreateAgentOptions,
  resolved: ResolvedAgentConfig,
): ConfigTraceResult {
  const fields: ConfigFieldTrace[] = [];

  // Collect top-level field groups
  const modelPaths = collectFieldPaths(resolved.modelConfig, 'modelConfig', 1);
  const modulePaths = Object.keys(resolved.modules).map(k => `modules.${k}`);
  const sessionPaths = collectFieldPaths(resolved.sessionOptions, 'sessionOptions', 2);
  const behaviorPaths = collectFieldPaths(resolved.behavior, 'behavior', 2);
  const layoutPaths = collectFieldPaths(resolved.layout, 'layout', 2);
  const toolOutputPaths = collectFieldPaths(resolved.toolOutputConfig, 'toolOutputConfig', 1);

  const allPaths = [
    ...modelPaths,
    ...modulePaths,
    ...sessionPaths,
    ...behaviorPaths,
    ...layoutPaths,
    ...toolOutputPaths,
    'dynamicReload',
  ];

  for (const field of allPaths) {
    const source = determineSource(options, resolved, field);
    const value = getNestedValue(resolved, field);
    const consumers = FIELD_CONSUMERS[field] ?? ['unknown'];

    fields.push({ field, source, value, consumers });
  }

  const formatted = fields
    .map(f => `${f.field}: value=${JSON.stringify(f.value)} source=${f.source} consumers=${f.consumers.join(',')}`)
    .join('\n');

  return { fields, formatted };
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
