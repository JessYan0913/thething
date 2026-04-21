import type { UIMessage } from 'ai';
import { DenialTracker } from '../agent-control/denial-tracking';
import { ModelSwapper } from '../agent-control/model-switching';
import { compactMessagesIfNeeded } from '../compaction';
import type { CompactionResult } from '../compaction/types';
import type { Skill } from '../skills/types';
import {
  createContentReplacementState,
  setToolOutputOverrides,
  type ContentReplacementState,
  type ToolOutputOverrides,
} from '../utils/tool-output-manager';
import { cleanupSessionToolResults } from '../utils/tool-result-storage';
import { CostTracker } from './cost';
import { TokenBudgetTracker } from './token-budget';

export interface SessionStateOptions {
  maxContextTokens?: number;
  compactThreshold?: number;
  maxBudgetUsd?: number;
  model?: string;
  maxDenialsPerTool?: number;
  /** 项目目录，用于工具结果持久化 */
  projectDir?: string;
  /** 工具输出配置覆盖（由应用层注入） */
  toolOutputOverrides?: ToolOutputOverrides;
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
  /** 项目目录 */
  projectDir: string;
  /** 内容替换状态（保证 prompt cache 稳定） */
  contentReplacementState: ContentReplacementState;

  compact(messages: UIMessage[]): Promise<CompactionResult>;
  abort(): void;
  /** 清理工具结果存储 */
  cleanupToolResults(): Promise<void>;
}

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