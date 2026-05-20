// ============================================================
// Session State - 会话状态管理
// ============================================================

import type { UIMessage } from 'ai';
import { DenialTracker } from './denial-tracking';
import { ModelSwapper } from './model-switching';
import { compactBeforeStep } from '../compaction';
import { DEFAULT_COMPACTION_CONFIG, type CompactionResult } from '../compaction/types';
import type { CompactionConfig } from '../compaction/types';
import type { Skill } from '../../modules/skills/types';
import {
  createContentReplacementState,
} from '../budget/tool-output-manager';
import { cleanupSessionToolResults } from '../budget/tool-result-storage';
import { CostTracker } from './cost';
import { TokenBudgetTracker } from './token-budget';
import type { SessionState, SessionStateOptions } from './types';
import { DEFAULT_MODEL_SPECS } from '../../services/config/behavior';
import { createPricingResolver } from '../../services/model/pricing';
import {
  COMPACT_TOKEN_THRESHOLD,
  DEFAULT_MAX_BUDGET_USD,
} from '../../services/config/defaults';
import { DEFAULT_CONTEXT_LIMIT } from '../../services/model/constants';

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
    pricingResolver = createPricingResolver(),
    taskStore = dataStore.taskStore,
    availableModels = DEFAULT_MODEL_SPECS,
    autoDowngradeCostThreshold = 80,
    compactionConfig,  // 新增：从 BehaviorConfig.compaction 传入
    compactionEnabled = true,
    permissionRules = [],
    extraSensitivePaths = [],
  } = options;

  const tokenBudget = new TokenBudgetTracker(maxContextTokens, compactThreshold);
  const costTracker = new CostTracker(conversationId, dataStore.costStore, {
    model,
    maxBudgetUsd,
    pricingResolver,
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
  });

  // 构建 压缩配置
  const compactionCfg: CompactionConfig = compactionConfig ?? DEFAULT_COMPACTION_CONFIG;

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
    taskStore,
    tokenBudget,
    costTracker,
    denialTracker,
    modelSwapper,
    activeSkills: new Set<string>(),
    loadedSkills: new Map<string, Skill>(),
    contentReplacementState: createContentReplacementState(),
    pendingCompactIds: [],
    compactionConfig: compactionCfg,
    compactModel: undefined,
    fallbackModels: undefined,
    dataStore: dataStore,

    async compact(messages: UIMessage[]): Promise<CompactionResult> {
      if (!compactionEnabled) {
        return { messages, executed: false, tokensFreed: 0, actions: [] };
      }
      // 调用 compactBeforeStep 执行完整的三层压缩
      if (state.compactModel && state.dataStore) {
        const beforeResult = await compactBeforeStep(
          messages,
          state,
          compactionCfg,
          {
            model: state.compactModel,
            fallbackModels: state.fallbackModels,
            modelName: state.model,
            conversationId,
            dataStore: state.dataStore,
          },
        );
        const tokensFreed = await estimateMessagesTokensDifference(messages, beforeResult);
        return {
          messages: beforeResult,
          executed: tokensFreed > 0,
          tokensFreed,
          actions: tokensFreed > 0 ? [`compactBeforeStep: freed ${tokensFreed} tokens`] : [],
        };
      }
      // Fallback: 仅 Layer 2（无模型实例时）
      const { manageToolOutputLifecycle } = await import('../compaction/lifecycle');
      const result = manageToolOutputLifecycle(messages, compactionCfg.lifecycle);
      return {
        messages: result.messages,
        executed: result.tokensFreed > 0,
        tokensFreed: result.tokensFreed,
        actions: result.tokensFreed > 0 ? [`Layer 2: freed ${result.tokensFreed} tokens`] : [],
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

async function estimateMessagesTokensDifference(before: UIMessage[], after: UIMessage[]): Promise<number> {
  try {
    const { estimateMessagesTokens } = await import('../compaction/token-counter');
    const beforeTokens = await estimateMessagesTokens(before);
    const afterTokens = await estimateMessagesTokens(after);
    return Math.max(0, beforeTokens - afterTokens);
  } catch {
    return 0;
  }
}
