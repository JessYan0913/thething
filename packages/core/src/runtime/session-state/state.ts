// ============================================================
// Session State - 会话状态管理
// ============================================================

import type { UIMessage } from 'ai';
import { DenialTracker } from '../agent-control/denial-tracking';
import { ModelSwapper } from '../agent-control/model-switching';
import { compactMessagesIfNeeded, type CompactOptions } from '../compaction';
import { toRuntimeCompactionConfig } from '../compaction/types';
import type { CompactionResult } from '../compaction/types';
import type { Skill } from '../../extensions/skills/types';
import {
  createContentReplacementState,
} from '../budget/tool-output-manager';
import { cleanupSessionToolResults } from '../budget/tool-result-storage';
import { CostTracker } from './cost';
import { TokenBudgetTracker } from './token-budget';
import type { SessionState, SessionStateOptions } from './types';
import { DEFAULT_MODEL_SPECS } from '../../config/behavior';
import { createPricingResolver } from '../../foundation/model/pricing';
import {
  DEFAULT_CONTEXT_LIMIT,
  COMPACT_TOKEN_THRESHOLD,
  DEFAULT_MAX_BUDGET_USD,
} from '../../config/defaults';

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

  // 构建压缩选项（从 BehaviorConfig 传入，转换 compactableTools 为 Set）
  const compactOptions: CompactOptions = {
    enabled: compactionEnabled,
    compactionConfig: compactionConfig ? toRuntimeCompactionConfig(compactionConfig) : undefined,
    compactionThreshold: compactThreshold,
  };

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

    async compact(messages: UIMessage[]): Promise<CompactionResult> {
      const result = await compactMessagesIfNeeded(messages, conversationId, dataStore, compactOptions);
      const compactionResult: CompactionResult = {
        messages: result.messages,
        executed: result.executed,
        type: 'auto',
        tokensFreed: result.tokensFreed,
      };
      tokenBudget.reportCompaction(compactionResult);
      return compactionResult;
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
