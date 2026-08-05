import type { LanguageModel, ModelMessage as ModelMessageType, PrepareStepFunction, PrepareStepResult, ToolSet, UIMessage, Tool, StepResult } from 'ai';

import type { PipelineContext } from '../session/interfaces';
import { estimateFullRequest, type FullRequestEstimation } from '../compaction/token-counter';
import { logger } from '../../primitives/logger';
import { buildContinuationPrompt, shouldContinue, checkMaxTurns, updateTokens } from '../../modules/goal';
import { buildCompactTaskSnapshot } from '../todos/todo-tools/todo-snapshot';

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

export interface CompactionStatusEvent {
  status: 'start' | 'end';
  /** 触发压缩时的水位百分比 */
  triggerWatermark?: number;
  /** 释放的 token 数 */
  tokensFreed?: number;
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
  /** 将模型名解析为已经套好遥测/成本中间件的实际模型。 */
  resolveModel?: (modelName: string) => LanguageModel;
  /** 压缩状态回调引用（流式通知前端） */
  compactionCallbackRef?: { current: ((event: CompactionStatusEvent) => void) | null };
}

export function getSkillStepOverrides(
  sessionState: Pick<PipelineContext, 'skillTurnOverride'>,
  resolveModel?: (modelName: string) => LanguageModel,
): Pick<NonNullable<PrepareStepResult<ToolSet>>, 'model' | 'providerOptions'> {
  const override = sessionState.skillTurnOverride;
  return {
    ...(override?.model && resolveModel
      ? { model: resolveModel(override.model) }
      : {}),
    ...(override?.effort
      ? {
          providerOptions: {
            openai: {
              reasoningEffort: override.effort,
            },
          },
        }
      : {}),
  };
}

export function createAgentPipeline<TOOLS extends ToolSet>(config: AgentPipelineConfig): PrepareStepFunction<TOOLS> {
  const { sessionState, debugEnabled } = config;

  const withSkillOverrides = (messages: ModelMessageType[]): PrepareStepResult<TOOLS> => ({
    messages,
    ...getSkillStepOverrides(sessionState, config.resolveModel),
  }) as PrepareStepResult<TOOLS>;

  const prepareStep: PrepareStepFunction<TOOLS> = async ({ stepNumber, messages, steps }) => {
    if (sessionState.aborted) {
      return { messages, tools: [] as any, continue: false } as PrepareStepResult<TOOLS>;
    }

    sessionState.turnCount = stepNumber + 1;

    // 压缩状态机：每步入口 tick（让 justCompacted 自动回 idle）
    sessionState.compactionTracker.tickStep(stepNumber);

    // accumulate 已在 route 的 onStepEnd 中完成，此处不再重复
    const lastStep = steps[steps.length - 1];
    // 注：阶段 3 改用 estimation 替代 tokenBudget.getSummary()（累计数学错）。
    // getSummary() 删除后会报 TS 错，先保留兼容性 fallback。
    const fallbackSummary = sessionState.tokenBudget.getSummary();
    const lastEst = sessionState.lastEstimation;
    const totalTokens = lastEst?.totalTokens ?? fallbackSummary.totalTokens;
    const utilizationPercent = lastEst?.utilizationPercent ?? 0;
    const shouldCompact = utilizationPercent >= sessionState.compactionTracker.getSnapshot().triggerPercent * 100;
    debugLog(
      debugEnabled,
      `[Agent] Step ${stepNumber + 1} | Tokens: ${totalTokens.toLocaleString()} (${utilizationPercent.toFixed(1)}%) | Compact: ${shouldCompact ? 'YES' : 'no'}`,
    );

    // 注入上下文水位信息（当使用率 > 60% 时让模型可见）
    if (utilizationPercent > 60) {
      const warningLevel = utilizationPercent > 85 ? ' ⚠️ CRITICAL' : utilizationPercent > 75 ? ' ⚠️ HIGH' : '';
      const contextHint = `[Context Usage: ${utilizationPercent.toFixed(0)}%${warningLevel}]\n` +
        (utilizationPercent > 75
          ? `Note: Large tool outputs can be recovered from disk if needed. Check tool result metadata for "[saved to: ...]" paths.\n`
          : '');
      messages = [...messages, {
        role: 'user',
        content: contextHint,
      } as ModelMessageType];
      debugLog(debugEnabled, `[Agent] Context usage ${utilizationPercent.toFixed(1)}%, injected hint`);
    }

    // 条件技能激活已移除，技能现在通过 Skill 工具主动调用

    if (sessionState.denialTracker.isThresholdExceeded()) {
      const injectMsg = sessionState.denialTracker.getInjectMessage();
      if (injectMsg) {
        debugLog(debugEnabled, `[Agent] Denial threshold exceeded, injecting warning message`);
        return withSkillOverrides([...messages, injectMsg as ModelMessageType]);
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
        return withSkillOverrides([...messages, {
          role: 'user',
          content: '你已经连续多次推理但没有采取行动。请立即调用工具执行操作，或者如果不确定，请调用 ask_user_question 询问用户。',
        } as ModelMessageType]);
      }
    }

    // 每步调用 compactBeforeStep（Layer 2 + Layer 3）
    // 状态机：先 recordAttempt，再 recordResult
    sessionState.compactionTracker.recordAttempt();
    const compactResult = await sessionState.compact(messages as import('ai').ModelMessage[]);
    sessionState.compactionTracker.recordResult(compactResult.tokensFreed ?? 0);
    if (compactResult.executed) {
      // UI 展示的是配置的压缩阈值，而不是会话累计 token 的动态百分比。
      // triggerPercent 的配置单位为 0-1，这里转为 0-100，并做边界保护。
      const triggerWatermark = Math.min(100, Math.max(0, (config.triggerPercent ?? DEFAULT_TRIGGER_PERCENT) * 100));
      config.compactionCallbackRef?.current?.({ status: 'start', triggerWatermark });
      debugLog(debugEnabled, `[Agent] Compaction freed ${compactResult.tokensFreed} tokens at configured ${triggerWatermark.toFixed(0)}% watermark`);
      messages = compactResult.messages as ModelMessageType[];
      sessionState.tokenBudget.reportCompaction(compactResult, triggerWatermark);
      sessionState.costTracker.reportCompaction(compactResult.tokensFreed ?? 0);
      config.compactionCallbackRef?.current?.({ status: 'end', triggerWatermark, tokensFreed: compactResult.tokensFreed ?? 0 });
    }

    // ── Task Context Injection ──
    // 三步触发：revision 变更、压缩后、5 步无活动
    const todoStore = sessionState.todoStore;
    const currentRevision = todoStore?.getRevision() ?? 0;
    sessionState.stepsSinceTodoMutation = (sessionState.stepsSinceTodoMutation ?? 0) + 1;
    const stepsSinceMutation = sessionState.stepsSinceTodoMutation;

    const revisionChanged = currentRevision !== (sessionState.lastTodoRevision ?? 0);
    const compactionJustRan = compactResult?.executed === true;
    const inactivityThreshold = !revisionChanged && !compactionJustRan && stepsSinceMutation >= 5;

    if (revisionChanged || compactionJustRan || inactivityThreshold) {
      const todos = todoStore?.getTodosByConversation(sessionState.conversationId);
      const snapshot = todos ? buildCompactTaskSnapshot(todos, todoStore) : null;
      if (snapshot) {
        const prefix = revisionChanged
          ? '[任务状态已更新]'
          : compactionJustRan
            ? '[上下文已压缩，当前任务状态]'
            : '[任务提醒]';
        messages = [...messages, {
          role: 'user',
          content: `${prefix}\n${snapshot}`,
        } as ModelMessageType];
        debugLog(debugEnabled, `[Agent] Task snapshot injected: revision=${currentRevision} changed=${revisionChanged} compact=${compactionJustRan} inactive=${inactivityThreshold}`);
      }
      sessionState.lastTodoRevision = currentRevision;
      sessionState.stepsSinceTodoMutation = 0;
    }

    // Context usage progress bar + 闸门(复用同一次估算,零新增开销)
    if (config.instructions != null && config.tools) {
      const estimation = await estimateFullRequest(
        messages as import('ai').ModelMessage[],
        config.instructions,
        config.tools,
        sessionState.model,
        config.contextLimit,
      );
      logger.info('Context', formatContextBar(estimation, estimation.modelLimit, config.triggerPercent ?? DEFAULT_TRIGGER_PERCENT));
      // 记录输入侧估算(排除输出预留),下一步收到真实 usage 时配对校准(见主文档 F)
      sessionState.tokenBudget.recordEstimate(estimation.totalTokens - estimation.outputReserve);
      // 缓存估算结果,供 onStepEnd 推送前端当前窗口占用 + 明细
      sessionState.lastEstimation = estimation;

      // 不静默发超标请求出去被 provider 拒。pre-stream 闸门见 create.ts;此处覆盖运行中增长。
      if (estimation.exceedsLimit) {
        const reason = `msgs=${estimation.messagesTokens}+inst=${estimation.instructionsTokens}+tools=${estimation.toolsTokens}+out=${estimation.outputReserve} = ${estimation.totalTokens} > ${estimation.modelLimit}`;
        logger.warn('Gate', `[REJECT] 运行中压缩后仍超限: ${reason} | conv=${sessionState.conversationId}`);
        throw new Error(`CONTEXT_BUDGET_EXCEEDED: 运行中压缩后仍超限(${reason})`);
      }
    }

    return {
      ...withSkillOverrides(messages),
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
