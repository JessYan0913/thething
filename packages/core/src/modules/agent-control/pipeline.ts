import type { LanguageModel, ModelMessage as ModelMessageType, PrepareStepFunction, PrepareStepResult, ToolSet, Tool } from 'ai';

import type { PipelineContext } from '../session/interfaces';
import { estimateRequestBudget, type RequestBudgetEstimation } from '../compaction/request-budget';
import { recordUsageSample } from '../compaction/tokenizer';
import { logger } from '../../primitives/logger';
import { buildCompactTaskSnapshot } from '../todos/todo-tools/todo-snapshot';
import type { TodoRuntime } from '../todos/todo-runtime';

function debugLog(debugEnabled: boolean | undefined, ...args: unknown[]): void {
  if (debugEnabled) {
    logger.debug('Pipeline', args.map(a => String(a)).join(' '));
  }
}

/** 从 Scheduler 派生「Ready / In Progress / Blocked」运行时视图（补充到任务画布）。 */
function buildRuntimeOverlay(scheduler: TodoRuntime): string {
  const state = scheduler.getRuntimeState();
  const lines: string[] = ['[任务运行时]'];
  const render = (title: string, todos: Array<{ subject: string }>): string => {
    if (todos.length === 0) return `${title}: 无`;
    return `${title}: ${todos.map(t => t.subject).join(' | ')}`;
  };
  lines.push(render('Ready(可执行)', state.ready));
  lines.push(render('In Progress', state.inProgress));
  if (state.blocked.length > 0) {
    lines.push(render('Blocked(等依赖)', state.blocked));
  }
  if (state.quiescent) {
    lines.push('(运行时寂静：无 ready / 无进行中)');
  }
  return lines.join('\n');
}

export interface CompactionStatusEvent {
  status: 'start' | 'end';
  /** 触发压缩时的水位百分比（start/end） */
  triggerWatermark?: number;
  /** 释放的 token 数（end） */
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
  /** per-model outputTokens（ModelEntry.outputTokens）——动态 outputReserve，预算与模型实际输出能力一致 */
  outputTokens?: number;
  triggerPercent?: number;
  /** 将模型名解析为已经套好遥测/成本中间件的实际模型。 */
  resolveModel?: (modelName: string) => LanguageModel;
  /** 压缩状态回调引用（流式通知前端） */
  compactionCallbackRef?: { current: ((event: CompactionStatusEvent) => void) | null };
  /** TodoRuntime（Todo Runtime）——任务状态派生 / 就绪判定的单一来源 */
  scheduler?: TodoRuntime;
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

/**
 * createAgentPipeline — One Loop / One Canvas。
 * 每个 step，在模型调用前**只做三件事**（docs/runtime.md §2）：
 *
 * 1. **任务画布组装**：从权威 store 读出唯一合法解析一次「任务画布」，以**一条** user 消息注入。
 *    触发时机：todo revision 变化 / 本次已压缩 / 连续 5 步无 todo 变更。
 *    （不变量 I1：run 中不手工删除/替换消息。子任务边界整段重建已删除，旧消息永远保留。）
 * 2. **L3 压缩**：compactBeforeStep——确定性摘要，每步调用，无旁路、无预检。
 * 3. **预算闸门**：估算总量超过窗口 → 先 L3 → 仍超 → **不抛异常杀流**，
 *    置 sessionState.exhaustFlag='context_budget' 并返回 continue:false（受控 exhausted，见 docs §2.2/D）。
 *
 * 已删除的 per-step 机制（归档重试 / 子任务边界重建 / 预算预检拆单 / step0 与每步劝导注入 /
 * 水位提示 / goal 续跑 / 推理空转催逼 / Completion Audit）：均违反 I1 或 I2，见 docs/runtime.md §2.2。
 */
export function createAgentPipeline<TOOLS extends ToolSet>(config: AgentPipelineConfig): PrepareStepFunction<TOOLS> {
  const { sessionState, debugEnabled } = config;

  // One Canvas 的会话内滑动指针：revision 变化 → 注入新画布。
  // 画布内容本身来自持久化 store（getRevision/getTodosByConversation），仅「最后一次所见 revision」
  // 是会话内备忘录——不跨请求成长、不参与任何状态推导。
  let lastTodoRevision = sessionState.todoStore?.getRevision() ?? 0;
  let stepsSinceMutation = 0;

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

    const todoStore = sessionState.todoStore;
    const conversationId = sessionState.conversationId;

    const currentRevision = todoStore?.getRevision() ?? 0;
    stepsSinceMutation += 1;
    const revisionChanged = currentRevision !== lastTodoRevision;

    // usage 真值校准配对(见 compaction-redesign.md L0):上一步估算 ↔ 本步真实 usage。
    if (steps.length > 0) {
      const lastUsage = steps[steps.length - 1]?.usage?.inputTokens;
      const lastEstForCalibration = sessionState.lastEstimation;
      if (lastUsage && lastEstForCalibration) {
        recordUsageSample(
          sessionState.model,
          lastEstForCalibration.totalTokens - lastEstForCalibration.outputReserve,
          lastUsage,
        );
      }
    }

    // ── L3 压缩（确定性摘要；每步调用，无旁路、无预检）──
    sessionState.compactionTracker.recordAttempt();
    const compactResult = await sessionState.compact(messages as import('ai').ModelMessage[]);
    sessionState.compactionTracker.recordResult(compactResult.tokensFreed ?? 0);
    if (compactResult.executed) {
      // UI 水位与真实触发线一致:优先用 policy 推导的 triggerTokens/modelLimit
      const lastEst = sessionState.lastEstimation;
      const triggerWatermark = lastEst?.triggerTokens && lastEst.modelLimit
        ? (lastEst.triggerTokens / lastEst.modelLimit) * 100
        : Math.min(100, Math.max(0, (config.triggerPercent ?? DEFAULT_TRIGGER_PERCENT) * 100));
      config.compactionCallbackRef?.current?.({ status: 'start', triggerWatermark });
      debugLog(debugEnabled, `[Agent] Compaction freed ${compactResult.tokensFreed} tokens at ${triggerWatermark.toFixed(0)}% watermark`);
      messages = compactResult.messages as ModelMessageType[];
      sessionState.tokenBudget.reportCompaction(compactResult, triggerWatermark);
      sessionState.costTracker.reportCompaction(compactResult.tokensFreed ?? 0);
      config.compactionCallbackRef?.current?.({ status: 'end', triggerWatermark, tokensFreed: compactResult.tokensFreed ?? 0 });
    }

    // ── One Canvas：唯一模型可见任务状态（至多一条 user 消息，内容全来自持久化 store）──
    const shouldInjectCanvas = revisionChanged || compactResult.executed || stepsSinceMutation >= 5;
    if (shouldInjectCanvas) {
      const todos = todoStore?.getTodosByConversation(conversationId) ?? [];
      const snapshot = buildCompactTaskSnapshot(todos, todoStore);
      const runtimeOverlay = config.scheduler && todos.length > 0
        ? buildRuntimeOverlay(config.scheduler)
        : null;
      // goal 持久化后（Phase F）画布含目标：仅活跃目标作为当前指令呈递
      // （complete 后不再把旧目标当"当前要执行的"，避免命令已完成的画布）。
      const goal = sessionState.goalState;
      const goalLine = goal && goal.status !== 'complete' && goal.objective
        ? `Goal: ${goal.objective}`
        : null;
      const body = [goalLine, snapshot, runtimeOverlay].filter(Boolean).join('\n');
      if (body) {
        const prefix = revisionChanged
          ? '[任务状态已更新]'
          : compactResult.executed
            ? '[上下文已压缩，当前任务画布]'
            : '[任务画布]';
        messages = [...messages, {
          role: 'user',
          content: `${prefix}\n${body}`,
        } as ModelMessageType];
        debugLog(debugEnabled, `[Agent] Task canvas injected: revision=${currentRevision} changed=${revisionChanged} compact=${compactResult.executed} inactive=${stepsSinceMutation >= 5}`);
      }
      lastTodoRevision = currentRevision;
      stepsSinceMutation = 0;
    }

    // deny 阈值硬停（安全闸，非 LLM 劝导）
    if (sessionState.denialTracker.isThresholdExceeded()) {
      const injectMsg = sessionState.denialTracker.getInjectMessage();
      if (injectMsg) {
        debugLog(debugEnabled, `[Agent] Denial threshold exceeded, injecting warning message`);
        return withSkillOverrides([...messages, injectMsg as ModelMessageType]);
      }
    }

    // ── 预算估计 + 闸门（不抛异常，受控 exhausted）──
    if (config.instructions != null && config.tools) {
      const estimation = await estimateRequestBudget(
        messages as import('ai').ModelMessage[],
        config.instructions,
        config.tools,
        sessionState.model,
        config.contextLimit,
        config.outputTokens,
      );
      logger.info('Context', formatContextBar(estimation, estimation.modelLimit));
      sessionState.tokenBudget.recordEstimate(estimation.totalTokens - estimation.outputReserve);
      sessionState.lastEstimation = estimation;

      // 硬不变量：含校准 buffer 的总量超过窗口上限 → 受控终止，不再 throw 杀流。
      // 置 exhausted(context_budget)，finalize 据此落 agent_runs 终态；模型可重开 run 继续。
      if (estimation.exceedsLimitWithBuffer) {
        const reason = `msgs=${estimation.messagesTokens}+inst=${estimation.instructionsTokens}+tools=${estimation.toolsTokens}+out=${estimation.outputReserve}+buf=${estimation.tokenizerBuffer} = ${estimation.totalTokensWithBuffer} > ${estimation.modelLimit}`;
        logger.warn('Gate', `[EXHAUST] 运行中压缩后仍超限: ${reason} | conv=${conversationId}`);
        sessionState.exhaustFlag = 'context_budget';
        return {
          ...withSkillOverrides(messages),
          continue: false,
        } as PrepareStepResult<TOOLS>;
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

function formatContextBar(est: RequestBudgetEstimation, contextLimit: number): string {
  // 用含校准 buffer 的总量计算水位;TRIGGER 标记与真实升档(shouldTrigger)一致
  const used = est.totalTokensWithBuffer;
  const pct = contextLimit > 0 ? used / contextLimit : 0;
  const filled = Math.min(BAR_WIDTH, Math.round(pct * BAR_WIDTH));
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const pctStr = (pct * 100).toFixed(1);
  const trigger = est.shouldTrigger ? ' ⚠ TRIGGER' : '';
  return (
    `${bar} ${pctStr}% (${formatTokens(used)}/${formatTokens(contextLimit)})${trigger}` +
    ` │ msgs ${formatTokens(est.messagesTokens)}` +
    ` │ sys ${formatTokens(est.instructionsTokens)}` +
    ` │ tools ${formatTokens(est.toolsTokens)}` +
    ` │ out ${formatTokens(est.outputReserve)}` +
    ` │ buf ${formatTokens(est.tokenizerBuffer)}`
  );
}