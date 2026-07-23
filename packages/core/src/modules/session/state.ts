// ============================================================
// Session State - 会话状态管理
// ============================================================


import { DenialTracker } from './denial-tracking';
import { ModelSwapper } from './model-switching';
import type { CompactionResult, CompactionConfig } from '../../services/config/compaction-types';
import type { Skill } from '../../modules/skills/types';
import {
  createContentReplacementState,
} from '../budget/tool-output-manager';
import { cleanupSessionToolResults } from '../budget/tool-result-storage';
import { CostTracker } from './cost';
import { TokenBudgetTracker } from './token-budget';
import type { SessionState, SessionStateOptions } from './types';
import { createPricingResolver } from '../../services/model/pricing';
import {
  COMPACT_TOKEN_THRESHOLD,
  DEFAULT_MAX_BUDGET_USD,
} from '../../services/config/defaults';
import { DEFAULT_CONTEXT_LIMIT } from '../../services/model/constants';
import { createCompactionView } from '../compaction/compaction-view';
import { CompactionTelemetry } from '../compaction/compaction-telemetry';
import { compactBeforeStep } from '../compaction';

export type { SessionState, SessionStateOptions };

/**
 * 创建会话状态
 *
 * 简化版：使用普通对象而非 getter/setter 闭包
 */
export function createSessionState(
  conversationId: string,
  options: SessionStateOptions,
): SessionState {
  const {
    maxContextTokens = DEFAULT_CONTEXT_LIMIT,
    compactThreshold = COMPACT_TOKEN_THRESHOLD,
    maxBudgetUsd = DEFAULT_MAX_BUDGET_USD,
    model = 'unknown',
    projectRoot = options.layout.resourceRoot,
    layout,
    toolOutputConfig,
    dataStore,
    pricingResolver,
    todoStore = dataStore.todoStore,
    availableModels = [],
    autoDowngradeCostThreshold = 80,
    taskComplexitySwitch,
    compactionConfig,  // 新增：从 BehaviorConfig.compaction 传入
    compactionEnabled = true,
    compact: compactFn,
    permissionRules = [],
    extraSensitivePaths = [],
  } = options;

  // 创建 pricingResolver，传入 availableModels 以获取定价信息
  const resolvedPricingResolver = pricingResolver ?? createPricingResolver(undefined, availableModels);

  const tokenBudget = new TokenBudgetTracker(maxContextTokens, compactThreshold);
  const costTracker = new CostTracker(conversationId, dataStore.costStore, {
    model,
    maxBudgetUsd,
    pricingResolver: resolvedPricingResolver,
  });
  const denialTracker = new DenialTracker({
    maxDenialsPerTool: options?.maxDenialsPerTool,
  });
  // 使用传入的 availableModels（消除硬编码）
  const modelSwapper = new ModelSwapper({
    availableModels: availableModels.map(m => ({
      id: m.id,
      name: m.name,
      costMultiplier: m.costMultiplier,
      capabilityTier: m.capabilityTier,
    })),
    currentModel: model,
    autoDowngradeCostThreshold,
    notifyOnSwitch: true,
    modelAliases: options?.modelAliases,
    taskComplexitySwitch,
  });

  // 构建 压缩配置
  const compactionCfg: CompactionConfig | undefined = compactionConfig;

  // 创建遥测收集器
  const telemetry = new CompactionTelemetry();

  // 使用普通对象，简化状态管理
  const state: SessionState = {
    conversationId,
    turnCount: 0,
    aborted: false,
    model,
    projectRoot,
    layout,
    toolOutputConfig: toolOutputConfig ?? {
      maxResultSizeChars: 50_000,
    },
    permissionRules: [...permissionRules],
    extraSensitivePaths: [...extraSensitivePaths],
    todoStore,
    tokenBudget,
    costTracker,
    denialTracker,
    modelSwapper,
    activeSkills: new Set<string>(),
    loadedSkills: new Map<string, Skill>(),
    contentReplacementState: createContentReplacementState(),
    consecutiveReasoningOnlySteps: 0,
    goalState: null,
    compactionConfig: compactionCfg,
    compactModel: undefined,
    fallbackModels: undefined,
    dataStore: dataStore,
    telemetry,
    compactionView: createCompactionView(telemetry),

    async compact(messages: import('ai').ModelMessage[]): Promise<CompactionResult> {
      if (!compactionEnabled) {
        return { messages, executed: false, tokensFreed: 0, actions: [] };
      }

      // 如果外部注入了 compactFn，使用它
      if (compactFn) {
        return compactFn(messages);
      }

      // 默认实现：调用 compactBeforeStep
      if (!state.compactModel || !compactionCfg) {
        return { messages, executed: false, tokensFreed: 0, actions: [] };
      }

      const compactedMessages = await compactBeforeStep(messages, compactionCfg, {
        model: state.compactModel,
        fallbackModels: state.fallbackModels,
        modelName: state.model,
        conversationId,
        dataStore,
        contextLimit: maxContextTokens,
        compactionView: state.compactionView,  // 🔑 传递视图
        telemetry: state.telemetry,  // 🆕 传递遥测
      });

      return {
        messages: compactedMessages,
        executed: compactedMessages.length !== messages.length,
        tokensFreed: 0,
        actions: [],
      };
    },

    abort() {
      state.aborted = true;
    },

    async cleanupToolResults(): Promise<void> {
      await cleanupSessionToolResults(conversationId, layout.dataDir);
    },
  };

  return state;
}
