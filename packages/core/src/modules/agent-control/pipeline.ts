import type { ModelMessage as ModelMessageType, PrepareStepFunction, PrepareStepResult, ToolSet, UIMessage, Tool } from 'ai';
import type { PipelineContext } from '../session/interfaces';
import { enforceToolResultBudget } from '../budget/message-budget';
import { estimateFullRequest, type FullRequestEstimation } from '../compaction/token-counter';
import { getModelContextLimit } from '../../services/model';
import { logger } from '../../primitives/logger';

function debugLog(debugEnabled: boolean | undefined, ...args: unknown[]): void {
  if (debugEnabled) {
    logger.debug('Pipeline', args.map(a => String(a)).join(' '));
  }
}

export interface AgentPipelineConfig {
  sessionState: PipelineContext;
  maxSteps?: number;
  maxBudgetUsd?: number;
  debugEnabled?: boolean;
  instructions?: string;
  tools?: Record<string, Tool>;
  contextLimit?: number;
}

export function createAgentPipeline<TOOLS extends ToolSet>(config: AgentPipelineConfig): PrepareStepFunction<TOOLS> {
  const { sessionState, debugEnabled } = config;

  const prepareStep: PrepareStepFunction<TOOLS> = async ({ stepNumber, messages, steps }) => {
    if (sessionState.aborted) {
      return { messages, tools: [] as any, continue: false } as PrepareStepResult<TOOLS>;
    }

    sessionState.turnCount = stepNumber + 1;

    const lastStep = steps[steps.length - 1];
    if (lastStep?.usage) {
      sessionState.tokenBudget.accumulate(lastStep.usage);
    }

    const budgetSummary = sessionState.tokenBudget.getSummary();
    debugLog(
      debugEnabled,
      `[Agent] Step ${stepNumber + 1} | Tokens: ${budgetSummary.totalTokens.toLocaleString()} (${budgetSummary.usagePercentage.toFixed(1)}%) | Compact: ${budgetSummary.shouldCompact ? 'YES' : 'no'}`,
    );

    // 条件技能激活已移除，技能现在通过 Skill 工具主动调用

    if (sessionState.denialTracker.isThresholdExceeded()) {
      const injectMsg = sessionState.denialTracker.getInjectMessage();
      if (injectMsg) {
        debugLog(debugEnabled, `[Agent] Denial threshold exceeded, injecting warning message`);
        return {
          messages: [...messages, injectMsg as ModelMessageType],
        } as PrepareStepResult<TOOLS>;
      }
    }

    const modelSwitchResult = sessionState.modelSwapper.checkUserIntent(messages);
    if (modelSwitchResult.switched) {
      debugLog(debugEnabled, `[Agent] Model switched: ${sessionState.model} -> ${modelSwitchResult.newModel}`);
      sessionState.model = modelSwitchResult.newModel!;
      if (modelSwitchResult.notification) {
        debugLog(debugEnabled, `[Agent] ${modelSwitchResult.notification}`);
      }
    }

    const costSummary = sessionState.costTracker.getSummary();
    const costPercent = (costSummary.totalCostUsd / costSummary.maxBudgetUsd) * 100;
    const costSwitchResult = sessionState.modelSwapper.checkCostBudget(costPercent);
    if (costSwitchResult.switched) {
      debugLog(debugEnabled, `[Agent] Auto-downgrade model due to cost: ${costSwitchResult.newModel}`);
      sessionState.model = costSwitchResult.newModel!;
    }

    // 每步调用 compactBeforeStep（Layer 1 + Layer 2 + Layer 3）
    const compactResult = await sessionState.compact(messages as unknown as UIMessage[]);
    if (compactResult.executed) {
      debugLog(debugEnabled, `[Agent] Compaction freed ${compactResult.tokensFreed} tokens`);
      messages = compactResult.messages as unknown as ModelMessageType[];
    }

    // ✅ 新增：工具结果预算检查
    // 在工具结果进入下一轮前，检查总额是否超过预算
    if (stepNumber > 0 && lastStep?.toolResults && lastStep.toolResults.length > 0) {
      const budgetResult = await enforceToolResultBudget(
        messages as unknown as UIMessage[],
        sessionState.contentReplacementState,
        sessionState.conversationId,
        sessionState.layout.dataDir,
        new Set(),
        sessionState.toolOutputConfig,
      );

      if (budgetResult.newlyPersisted.length > 0) {
        debugLog(
          debugEnabled,
          `[Agent] Tool result budget: persisted ${budgetResult.newlyPersisted.length} results, ` +
          `saved ${budgetResult.tokensSaved} tokens`
        );
        messages = budgetResult.messages as unknown as ModelMessageType[];
      }
    }

    // Context usage progress bar
    if (config.instructions != null && config.tools) {
      const estimation = await estimateFullRequest(
        messages as unknown as UIMessage[],
        config.instructions,
        config.tools,
        sessionState.model,
      );
      const limit = config.contextLimit
        ? getModelContextLimit(sessionState.model, config.contextLimit)
        : estimation.modelLimit;
      logger.info('Context', formatContextBar(estimation, limit));
    }

    return {
      messages,
      continue: true,
    } as unknown as PrepareStepResult<TOOLS>;
  };

  return prepareStep;
}

const BAR_WIDTH = 20;
const TRIGGER_PERCENT = 0.85;

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatContextBar(est: FullRequestEstimation, contextLimit: number): string {
  const used = est.messagesTokens + est.instructionsTokens + est.toolsTokens + est.outputReserve;
  const pct = contextLimit > 0 ? used / contextLimit : 0;
  const filled = Math.min(BAR_WIDTH, Math.round(pct * BAR_WIDTH));
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const pctStr = (pct * 100).toFixed(1);
  const trigger = pct >= TRIGGER_PERCENT ? ' ⚠ TRIGGER' : '';
  return (
    `${bar} ${pctStr}% (${formatTokens(used)}/${formatTokens(contextLimit)})${trigger}` +
    ` │ msgs ${formatTokens(est.messagesTokens)}` +
    ` │ sys ${formatTokens(est.instructionsTokens)}` +
    ` │ tools ${formatTokens(est.toolsTokens)}` +
    ` │ out ${formatTokens(est.outputReserve)}`
  );
}
