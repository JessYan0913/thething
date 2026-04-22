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

export type { SessionState, SessionStateOptions };

export function createSessionState(conversationId: string, options?: SessionStateOptions): SessionState {
  const {
    maxContextTokens = 128_000,
    compactThreshold = 25_000,
    maxBudgetUsd = 5.0,
    model = 'unknown',
    projectDir = process.cwd(),
    toolOutputOverrides,
  } = options ?? {};

  // 应用工具输出配置覆盖（如果有）
  if (toolOutputOverrides) {
    setToolOutputOverrides(toolOutputOverrides);
  }

  const tokenBudget = new TokenBudgetTracker(maxContextTokens, compactThreshold);
  const costTracker = new CostTracker(conversationId, { model, maxBudgetUsd });
  const denialTracker = new DenialTracker({ maxDenialsPerTool: options?.maxDenialsPerTool });
  const modelSwapper = new ModelSwapper({
    availableModels: [
      { id: 'qwen-max', name: 'Qwen Max', costMultiplier: 1.0, capabilityTier: 3 },
      { id: 'qwen-plus', name: 'Qwen Plus', costMultiplier: 0.4, capabilityTier: 2 },
      { id: 'qwen-turbo', name: 'Qwen Turbo', costMultiplier: 0.1, capabilityTier: 1 },
    ],
    currentModel: model,
    autoDowngradeCostThreshold: 80,
    notifyOnSwitch: true,
  });
  let turnCount = 0;
  let aborted = false;
  const activeSkills = new Set<string>();
  const loadedSkills = new Map<string, Skill>();
  const contentReplacementState = createContentReplacementState();

  const state: SessionState = {
    conversationId,
    get turnCount() {
      return turnCount;
    },
    set turnCount(value: number) {
      turnCount = value;
    },
    tokenBudget,
    costTracker,
    denialTracker,
    modelSwapper,
    activeSkills,
    loadedSkills,
    model,
    projectDir,
    contentReplacementState,
    get aborted() {
      return aborted;
    },
    set aborted(value: boolean) {
      aborted = value;
    },

    async compact(messages: UIMessage[]): Promise<CompactionResult> {
      const result = await compactMessagesIfNeeded(messages, conversationId);
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
      aborted = true;
    },

    async cleanupToolResults(): Promise<void> {
      await cleanupSessionToolResults(conversationId, projectDir);
    },
  };

  return state;
}