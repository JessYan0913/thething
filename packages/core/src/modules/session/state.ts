// ============================================================
// Session State - 会话状态管理
// ============================================================


import { DenialTracker } from './denial-tracking';
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
import { ContextLedger } from '../compaction/context-ledger';
import { compactBeforeStep } from '../compaction';
import { CompactionStateTracker } from '../compaction/state-tracker';

export type { SessionState, SessionStateOptions };

/**
 * 创建会话状态
 *
 * 简化版：使用普通对象而非 getter/setter 闭包
 */
export async function createSessionState(
  conversationId: string,
  options: SessionStateOptions,
): Promise<SessionState> {
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
    compactionConfig,  // 新增：从 BehaviorConfig.compaction 传入
    compactionEnabled = true,
    compact: compactFn,
    permissionRules = [],
    extraSensitivePaths = [],
  } = options;

  const resolvedPricingResolver = pricingResolver ?? createPricingResolver(undefined, []);

  const tokenBudget = new TokenBudgetTracker(maxContextTokens, compactThreshold);
  const costTracker = new CostTracker(conversationId, dataStore.costStore, {
    model,
    maxBudgetUsd,
    pricingResolver: resolvedPricingResolver,
  });
  await costTracker.hydrate();
  const denialTracker = new DenialTracker({
    maxDenialsPerTool: options?.maxDenialsPerTool,
  });

  // 构建 压缩配置
  const compactionCfg: CompactionConfig | undefined = compactionConfig;

  // 创建遥测收集器
  const telemetry = new CompactionTelemetry();

  // 上下文台账 + pin 注册表（会话级，读循环熔断与 context_pin 工具共享）
  const contextLedger = new ContextLedger();

  // 会话级压缩步数计数器（跨 API 调用持久），用于 TTL 老化
  const compactionStepCounter = { current: 0 };

  // 压缩状态机 + 事件累计（新；与 tokenBudget 正交）
  // triggerPercent 来自 compactionConfig.contextWindow.triggerPercent（默认 0.85）
  const compactionTracker = new CompactionStateTracker({
    triggerPercent: compactionConfig?.contextWindow.triggerPercent ?? 0.85,
  });

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
    contextLedger,
    compactionStepCounter,
    pendingArchiveRetries: new Map<string, string>(),
    compactionView: createCompactionView(telemetry),
    compactionTracker,
    lastEstimation: undefined,
    lastTodoRevision: 0,
    stepsSinceTodoMutation: 0,
    pendingArchiveTodoId: null,
    subtaskStartMessageIndex: 0,
    enableSubtaskArchiving: options?.enableSubtaskArchiving ?? true,

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
        ledger: state.contextLedger,  // 传递台账（读循环熔断 + pin）
        compactionStep: state.compactionStepCounter,  // 传递 TTL 步数计数器
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
