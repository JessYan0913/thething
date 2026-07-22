import type { ModelMessage as ModelMessageType, PrepareStepFunction, PrepareStepResult, ToolSet, UIMessage, Tool, StepResult } from 'ai';

import type { PipelineContext } from '../session/interfaces';
import { estimateFullRequest, type FullRequestEstimation } from '../compaction/token-counter';
import { getModelContextLimit } from '../../services/model';
import { logger } from '../../primitives/logger';
import { estimateTaskComplexity } from '../session/task-complexity';
import { buildContinuationPrompt, shouldContinue, checkMaxTurns, updateTokens } from '../../modules/goal';

function debugLog(debugEnabled: boolean | undefined, ...args: unknown[]): void {
  if (debugEnabled) {
    logger.debug('Pipeline', args.map(a => String(a)).join(' '));
  }
}

/** 连续纯推理步数阈值，超过此值注入提示强制行动 */
const REASONING_LOOP_THRESHOLD = 3;

/**
 * 检测单步是否为纯推理（只有 reasoning，没有工具调用和文本输出）
 */
function isReasoningOnlyStep(step: StepResult<any, any>): boolean {
  const hasToolCall = step.toolCalls.length > 0 || step.dynamicToolCalls.length > 0;
  const hasText = step.text.trim().length > 0;
  const hasReasoning = step.reasoning.length > 0;
  return hasReasoning && !hasToolCall && !hasText;
}

export interface AgentPipelineConfig {
  sessionState: PipelineContext;
  maxSteps?: number;
  maxBudgetUsd?: number;
  debugEnabled?: boolean;
  instructions?: string;
  tools?: Record<string, Tool>;
  contextLimit?: number;
  triggerPercent?: number;
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

    // 注入上下文水位信息（当使用率 > 60% 时让模型可见）
    if (budgetSummary.usagePercentage > 60) {
      const warningLevel = budgetSummary.usagePercentage > 85 ? ' ⚠️ CRITICAL' : budgetSummary.usagePercentage > 75 ? ' ⚠️ HIGH' : '';
      const contextHint = `[Context Usage: ${budgetSummary.usagePercentage.toFixed(0)}%${warningLevel}]\n` +
        (budgetSummary.usagePercentage > 75
          ? `Note: Large tool outputs can be recovered from disk if needed. Check tool result metadata for "[saved to: ...]" paths.\n`
          : '');
      messages = [...messages, {
        role: 'user',
        content: contextHint,
      } as ModelMessageType];
      debugLog(debugEnabled, `[Agent] Context usage ${budgetSummary.usagePercentage.toFixed(1)}%, injected hint`);
    }

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

    // Goal 持续驱动检查
    if (sessionState.goalState && shouldContinue(sessionState.goalState)) {
      // 更新 token 使用量
      if (lastStep?.usage) {
        sessionState.goalState = updateTokens(
          sessionState.goalState,
          (lastStep.usage.inputTokens ?? 0) + (lastStep.usage.outputTokens ?? 0),
        );
      }

      // 检查是否达到最大轮次
      sessionState.goalState = checkMaxTurns(sessionState.goalState);

      // 如果目标仍然活跃，注入 continuation prompt
      if (shouldContinue(sessionState.goalState)) {
        const continuationPrompt = buildContinuationPrompt(sessionState.goalState);
        debugLog(debugEnabled, `[Agent] Goal active, injecting continuation prompt`);
        messages = [...messages, { role: 'user', content: continuationPrompt } as ModelMessageType];
      }
    }

    // 推理循环检测：连续纯推理无工具调用时注入提示
    if (steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      if (isReasoningOnlyStep(lastStep)) {
        sessionState.consecutiveReasoningOnlySteps++;
      } else {
        sessionState.consecutiveReasoningOnlySteps = 0;
      }

      if (sessionState.consecutiveReasoningOnlySteps >= REASONING_LOOP_THRESHOLD) {
        debugLog(debugEnabled, `[Agent] Reasoning loop detected: ${sessionState.consecutiveReasoningOnlySteps} consecutive reasoning-only steps`);
        sessionState.consecutiveReasoningOnlySteps = 0;
        return {
          messages: [...messages, {
            role: 'user',
            content: '你已经连续多次推理但没有采取行动。请立即调用工具执行操作，或者如果不确定，请调用 ask_user_question 询问用户。',
          } as ModelMessageType],
        } as PrepareStepResult<TOOLS>;
      }
    }

    const modelSwitchResult = sessionState.modelSwapper.checkUserIntent(messages);
    if (modelSwitchResult.switched) {
      debugLog(debugEnabled, `[Agent] Model switched: ${sessionState.model} -> ${modelSwitchResult.newModel}`);
      sessionState.model = modelSwitchResult.newModel!;
      // 更新上下文长度限制
      const newContextLimit = sessionState.modelSwapper.getCurrentContextLimit();
      if (newContextLimit) {
        config.contextLimit = newContextLimit;
        debugLog(debugEnabled, `[Agent] Context limit updated to: ${newContextLimit}`);
      }
      if (modelSwitchResult.notification) {
        debugLog(debugEnabled, `[Agent] ${modelSwitchResult.notification}`);
      }
    }

    // 任务复杂度检查
    const complexityScore = estimateTaskComplexity(messages as unknown as import('ai').ModelMessage[]);
    const complexityResult = sessionState.modelSwapper.checkTaskComplexity(complexityScore);
    if (complexityResult.switched) {
      debugLog(debugEnabled, `[Agent] Model switched due to complexity (${complexityScore}): ${sessionState.model} -> ${complexityResult.newModel}`);
      sessionState.model = complexityResult.newModel!;
      // 更新上下文长度限制
      const newContextLimit = sessionState.modelSwapper.getCurrentContextLimit();
      if (newContextLimit) {
        config.contextLimit = newContextLimit;
        debugLog(debugEnabled, `[Agent] Context limit updated to: ${newContextLimit}`);
      }
      if (complexityResult.notification) {
        debugLog(debugEnabled, `[Agent] ${complexityResult.notification}`);
      }
    }

    const costSummary = sessionState.costTracker.getSummary();
    const costPercent = (costSummary.totalCostUsd / costSummary.maxBudgetUsd) * 100;
    const costSwitchResult = sessionState.modelSwapper.checkCostBudget(costPercent);
    if (costSwitchResult.switched) {
      debugLog(debugEnabled, `[Agent] Auto-downgrade model due to cost: ${costSwitchResult.newModel}`);
      sessionState.model = costSwitchResult.newModel!;
      // 更新上下文长度限制
      const newContextLimit = sessionState.modelSwapper.getCurrentContextLimit();
      if (newContextLimit) {
        config.contextLimit = newContextLimit;
        debugLog(debugEnabled, `[Agent] Context limit updated to: ${newContextLimit}`);
      }
    }

    // 每步调用 compactBeforeStep（Layer 2 + Layer 3）
    const compactResult = await sessionState.compact(messages as import('ai').ModelMessage[]);
    if (compactResult.executed) {
      debugLog(debugEnabled, `[Agent] Compaction freed ${compactResult.tokensFreed} tokens`);
      messages = compactResult.messages as ModelMessageType[];
    }

    // Context usage progress bar
    if (config.instructions != null && config.tools) {
      const estimation = await estimateFullRequest(
        messages as import('ai').ModelMessage[],
        config.instructions,
        config.tools,
        sessionState.model,
      );
      const limit = config.contextLimit
        ? getModelContextLimit(sessionState.model, config.contextLimit)
        : estimation.modelLimit;
      logger.info('Context', formatContextBar(estimation, limit, config.triggerPercent ?? DEFAULT_TRIGGER_PERCENT));
      // 记录输入侧估算(排除输出预留),下一步收到真实 usage 时配对校准(见主文档 F)
      sessionState.tokenBudget.recordEstimate(estimation.totalTokens - estimation.outputReserve);
    }

    return {
      messages,
      continue: true,
    } as unknown as PrepareStepResult<TOOLS>;
  };

  return prepareStep;
}

const BAR_WIDTH = 20;
const DEFAULT_TRIGGER_PERCENT = 0.85;

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatContextBar(est: FullRequestEstimation, contextLimit: number, triggerPercent: number = DEFAULT_TRIGGER_PERCENT): string {
  const used = est.messagesTokens + est.instructionsTokens + est.toolsTokens + est.outputReserve;
  const pct = contextLimit > 0 ? used / contextLimit : 0;
  const filled = Math.min(BAR_WIDTH, Math.round(pct * BAR_WIDTH));
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const pctStr = (pct * 100).toFixed(1);
  const trigger = pct >= triggerPercent ? ' ⚠ TRIGGER' : '';
  return (
    `${bar} ${pctStr}% (${formatTokens(used)}/${formatTokens(contextLimit)})${trigger}` +
    ` │ msgs ${formatTokens(est.messagesTokens)}` +
    ` │ sys ${formatTokens(est.instructionsTokens)}` +
    ` │ tools ${formatTokens(est.toolsTokens)}` +
    ` │ out ${formatTokens(est.outputReserve)}`
  );
}
