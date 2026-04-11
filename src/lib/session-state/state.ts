import type { UIMessage } from 'ai';
import { DenialTracker } from '../agent-control/denial-tracking';
import { ModelSwapper } from '../agent-control/model-switching';
import { compactMessagesIfNeeded } from '../compaction';
import type { CompactionResult } from '../compaction/types';
import type { Skill } from '../skills/types';
import { CostTracker } from './cost';
import { TokenBudgetTracker } from './token-budget';

export interface SessionStateOptions {
  maxContextTokens?: number;
  compactThreshold?: number;
  maxBudgetUsd?: number;
  model?: string;
  maxDenialsPerTool?: number;
}

export interface SessionState {
  conversationId: string;
  turnCount: number;
  tokenBudget: TokenBudgetTracker;
  costTracker: CostTracker;
  denialTracker: DenialTracker;
  modelSwapper: ModelSwapper;
  activeSkills: Set<string>;
  loadedSkills: Map<string, Skill>;
  model: string;
  aborted: boolean;

  compact(messages: UIMessage[]): Promise<CompactionResult>;
  abort(): void;
}

export function createSessionState(conversationId: string, options?: SessionStateOptions): SessionState {
  const {
    maxContextTokens = 128_000,
    compactThreshold = 25_000,
    maxBudgetUsd = 5.0,
    model = process.env.DASHSCOPE_MODEL ?? 'unknown',
  } = options ?? {};

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
  };

  return state;
}