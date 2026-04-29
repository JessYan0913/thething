// ============================================================
// Session State - 会话状态管理
// ============================================================

import type { UIMessage } from 'ai';
import { DenialTracker } from '../agent-control/denial-tracking';
import { ModelSwapper } from '../agent-control/model-switching';
import { compactMessagesIfNeeded } from '../compaction';
import type { CompactionResult } from '../compaction/types';
import type { Skill } from '../../extensions/skills/types';
import {
  createContentReplacementState,
  setToolOutputOverrides,
} from '../budget/tool-output-manager';
import { cleanupSessionToolResults } from '../budget/tool-result-storage';
import { CostTracker } from './cost';
import { TokenBudgetTracker } from './token-budget';
import type { SessionState, SessionStateOptions } from './types';
import { DEFAULT_MODEL_SPECS } from '../../config/behavior';

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
    maxContextTokens = 128_000,
    compactThreshold = 25_000,
    maxBudgetUsd = 5.0,
    model = 'unknown',
    projectDir = process.cwd(),
    toolOutputOverrides,
    dataStore,
    availableModels = DEFAULT_MODEL_SPECS,
    autoDowngradeCostThreshold = 80,
  } = options;

  // 应用工具输出配置覆盖（如果有）
  if (toolOutputOverrides) {
    setToolOutputOverrides(toolOutputOverrides);
  }

  const tokenBudget = new TokenBudgetTracker(maxContextTokens, compactThreshold);
  const costTracker = new CostTracker(conversationId, dataStore.costStore, { model, maxBudgetUsd });
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
  });

  // 使用普通对象，简化状态管理
  const state: SessionState = {
    conversationId,
    turnCount: 0,
    aborted: false,
    model,
    projectDir,
    tokenBudget,
    costTracker,
    denialTracker,
    modelSwapper,
    activeSkills: new Set<string>(),
    loadedSkills: new Map<string, Skill>(),
    contentReplacementState: createContentReplacementState(),

    async compact(messages: UIMessage[]): Promise<CompactionResult> {
      const result = await compactMessagesIfNeeded(messages, conversationId, dataStore);
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
      await cleanupSessionToolResults(conversationId, projectDir);
    },
  };

  return state;
}