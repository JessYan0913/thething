import type { LanguageModel, ModelMessage as ModelMessageType, PrepareStepFunction, PrepareStepResult, ToolSet, UIMessage, Tool, StepResult } from 'ai';

import type { PipelineContext } from '../session/interfaces';
import { estimateRequestBudget, type RequestBudgetEstimation } from '../compaction/request-budget';
import { recordUsageSample } from '../compaction/tokenizer';
import { logger } from '../../primitives/logger';
import { buildContinuationPrompt, shouldContinue, checkMaxTurns, updateTokens } from '../../modules/goal';
import { buildCompactTaskSnapshot } from '../todos/todo-tools/todo-snapshot';
import { buildPlanPrompt, buildTodoSyncReminder, buildEmptyTodoReminder } from './plan-prompt';
import { buildSubtaskContext, getCurrentTodo, getIndexPoolSize } from './context-builder';
import { archiveSubtask, renderSubtaskText, retryPendingArchives } from './archiver';
import { splitTodo } from './splitter';
import type { TodoRuntime } from '../todos/todo-runtime';
import { buildCompletionAuditPrompt } from './completion-audit';

function debugLog(debugEnabled: boolean | undefined, ...args: unknown[]): void {
  if (debugEnabled) {
    logger.debug('Pipeline', args.map(a => String(a)).join(' '));
  }
}

/** 从 Scheduler 派生「Ready / In Progress / Blocked」运行时视图（补充到任务快照）。 */
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
    lines.push('(运行时寂静：无 ready / 无进行中 / 无待归档)');
  }
  return lines.join('\n');
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
  status: 'start' | 'end' | 'task_split' | 'archiving_failed' | 'index_pool_updated';
  /** 触发压缩时的水位百分比（start/end） */
  triggerWatermark?: number;
  /** 释放的 token 数（end） */
  tokensFreed?: number;
  /** 被拆分的 todo id（task_split/archiving_failed） */
  todoId?: string;
  /** 拆分后新子任务数量（task_split） */
  newSubtaskCount?: number;
  /** 拆分前估算 tokens（task_split） */
  estimatedTokensBefore?: number;
  /** 触发阈值 tokens（task_split） */
  triggerTokens?: number;
  /** 索引池条数 0-50（index_pool_updated） */
  indexPoolSize?: number;
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

    // Phase A 规划提示：判断一律交给模型——代码只做确定性的机械活（每条请求开工前
    // 轻问一句，不做任何关键词/字数预判）。
    const todoStore = sessionState.todoStore;

    // 归档失败重试：上一轮归档失败的子任务（已缓存渲染文本）本轮重试一次。
    // 不阻塞主流程——重试成功写 facts，失败上抛 archiving_failed 事件并跳过（保留 result）。
    if (sessionState.enableSubtaskArchiving !== false && sessionState.pendingArchiveRetries.size > 0 && todoStore && sessionState.compactModel) {
      const retried = await retryPendingArchives(sessionState.pendingArchiveRetries, {
        store: todoStore,
        model: sessionState.compactModel,
        fallbackModels: sessionState.fallbackModels,
        modelName: sessionState.model,
        onRetryFailed: (todoId) => config.compactionCallbackRef?.current?.({ status: 'archiving_failed', todoId }),
      });
      if (retried.length > 0) {
        debugLog(debugEnabled, `[Agent] Archived retry for ${retried.length} subtask(s)`);
      }
    }

    // ── 子任务独立上下文范式（Task Paradigm Redesign §4）：子任务边界重建 ──
    // todo-write 标记 completed/failed 时设置 sessionState.pendingArchiveTodoId；
    // 此处检测到即重建干净上下文（索引池 + 当前子任务 + 读回指针），不继承上一子任务原始日志。
    const pendingArchiveTodoId = sessionState.pendingArchiveTodoId;
    if (pendingArchiveTodoId) {
      // 1. 归档：用旧 messages 切片（subtaskStartMessageIndex 起）提炼 facts 写入该 todo。
      //    必须在重建前完成——重建后上一子任务消息即被替换。
      //    enableSubtaskArchiving=false 时跳过事实归档，保留 result 字符串（模型写入）。
      if (sessionState.enableSubtaskArchiving !== false && todoStore && sessionState.compactModel) {
        const slice = messages.slice(sessionState.subtaskStartMessageIndex) as import('ai').ModelMessage[];
        const facts = await archiveSubtask(todoStore, pendingArchiveTodoId, slice, {
          model: sessionState.compactModel,
          fallbackModels: sessionState.fallbackModels,
          modelName: sessionState.model,
        });
        if (facts) {
          sessionState.pendingArchiveRetries.delete(pendingArchiveTodoId);
        } else {
          // 首败：缓存渲染文本入队，下一轮 prepareStep 重试一次（不立即报事件；
          // archiving_failed 仅在重试也失败时上抛，见 retryPendingArchives）
          const text = renderSubtaskText(slice);
          if (text.trim()) {
            sessionState.pendingArchiveRetries.set(pendingArchiveTodoId, text);
          }
          logger.warn('Archiver', `[archiving_failed] 子任务 ${pendingArchiveTodoId} 事实归档失败，已入队待重试（保留 result）`);
        }
      }

      // 2. 重建干净上下文（索引池 + 当前子任务 + 读回指针），不继承上一子任务原始日志。
      const todos = todoStore?.getTodosByConversation(sessionState.conversationId) ?? [];
      messages = buildSubtaskContext(todos);
      sessionState.pendingArchiveTodoId = null;
      sessionState.subtaskStartMessageIndex = messages.length;
      config.compactionCallbackRef?.current?.({ status: 'index_pool_updated', indexPoolSize: getIndexPoolSize(todos) });

      // 预算预检：新鲜子任务上下文若已超触发线 → 子任务本身过大，就地拆分（取消 + 建新）并重建指向第一个新子任务。
      // 在 prepareStep 内处理：chat 与 inbound 共用本步，避免在两个执行路径做危险的流重入。
      if (config.instructions != null && config.tools) {
        const precheck = await estimateRequestBudget(
          messages as import('ai').ModelMessage[],
          config.instructions,
          config.tools,
          sessionState.model,
          config.contextLimit,
          config.outputTokens,
        );
        if (precheck.shouldTrigger) {
          const current = getCurrentTodo(todos);
          if (current) {
            const created = await splitTodo(todoStore, current, {
              model: sessionState.compactModel,
              runtime: config.scheduler,
            });
            if (created.length > 0) {
              sessionState.telemetry.recordTaskSplit({
                todoId: current.id,
                reason: 'budget_exceeded',
                newSubtaskCount: created.length,
                estimatedTokensBefore: precheck.totalTokensWithBuffer,
                triggerTokens: precheck.triggerTokens,
              });
              config.compactionCallbackRef?.current?.({
                status: 'task_split',
                todoId: current.id,
                newSubtaskCount: created.length,
                estimatedTokensBefore: precheck.totalTokensWithBuffer,
                triggerTokens: precheck.triggerTokens,
              });
              const newTodos = todoStore?.getTodosByConversation(sessionState.conversationId) ?? [];
              messages = buildSubtaskContext(newTodos);
              sessionState.subtaskStartMessageIndex = messages.length;
              config.compactionCallbackRef?.current?.({ status: 'index_pool_updated', indexPoolSize: getIndexPoolSize(newTodos) });
              debugLog(debugEnabled, `[Agent] Subtask too complex, split "${current.subject}" into ${created.length} subtasks`);
            }
            // created.length===0 → 已原子无法拆分，保持原样（交由现有 budget gate 处理）
          }
        }
      }
      debugLog(debugEnabled, `[Agent] Subtask boundary: rebuilt context for completed todo ${pendingArchiveTodoId}`);
    }

    if (stepNumber === 0) {
      const convTodos = todoStore?.getTodosByConversation(sessionState.conversationId) ?? [];
      const todosEmpty = convTodos.length === 0;
      if (todosEmpty) {
        // 第一轮 / 无任何 todo：注入任务规划引导，鼓励对复杂需求建清单
        messages = [...messages, {
          role: 'user',
          content: buildPlanPrompt(),
        } as ModelMessageType];
        debugLog(debugEnabled, `[Agent] Plan prompt injected at step 0`);
      } else {
        // 后续轮新消息：清单非空（延续既有任务），注入“同步/添加”引导，
        // 让模型对新的子需求向现有清单追加维护，而不是既不建也不维护。
        messages = [...messages, {
          role: 'user',
          content: buildTodoSyncReminder(),
        } as ModelMessageType];
        debugLog(debugEnabled, `[Agent] Todo sync reminder injected at step 0 (${convTodos.length} persisted todos, continuation)`);
      }
    } else {
      // rung-2 跟进：有活跃 todo（pending/in_progress）时，每次决策前轻提一行，
      // 防止模型"只开工不跟进"（建完清单后一路做完、从不结清）
      const activeTodos = (todoStore?.getTodosByConversation(sessionState.conversationId) ?? [])
        .filter(t => t.status === 'pending' || t.status === 'in_progress');
      if (activeTodos.length > 0) {
        messages = [...messages, {
          role: 'user',
          content: buildTodoSyncReminder(),
        } as ModelMessageType];
        debugLog(debugEnabled, `[Agent] Todo sync reminder injected at step ${stepNumber} (${activeTodos.length} active)`);
      }
    }

    // accumulate 已在 route 的 onStepEnd 中完成，此处不再重复
    const lastStep = steps[steps.length - 1];

    // usage 真值校准配对(见 compaction-redesign.md L0):上一步估算 ↔ 本步真实 usage。
    // lastEstimation 是上次 prepareStep 为本请求发出的估算;lastStep.usage 是其真实 input。
    // 仅当两者都可用时配对(per-session,无跨会话污染)。
    const lastEstForCalibration = sessionState.lastEstimation;
    if (lastStep?.usage?.inputTokens && lastEstForCalibration) {
      recordUsageSample(
        sessionState.model,
        lastEstForCalibration.totalTokens - lastEstForCalibration.outputReserve,
        lastStep.usage.inputTokens,
      );
    }
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
      // UI 水位与真实触发线一致:优先用 policy 推导的 triggerTokens/modelLimit
      // (lastEst 为本会话上次请求的策略估值),缺省回退用户配置 triggerPercent(0-1)。
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

    // ── Task Context Injection ──
    // 三步触发：revision 变更、压缩后、5 步无活动
    const currentRevision = todoStore?.getRevision() ?? 0;
    sessionState.stepsSinceTodoMutation = (sessionState.stepsSinceTodoMutation ?? 0) + 1;
    const stepsSinceMutation = sessionState.stepsSinceTodoMutation;

    const revisionChanged = currentRevision !== (sessionState.lastTodoRevision ?? 0);
    const compactionJustRan = compactResult?.executed === true;
    const inactivityThreshold = !revisionChanged && !compactionJustRan && stepsSinceMutation >= 5;

    // 任何 todo 变更（出现新 ready / 新用户声明）→ 重新武装 Completion Audit（下一次 quiescence 再注入）
    if (revisionChanged) {
      sessionState.completionAuditInjected = false;
    }

    if (revisionChanged || compactionJustRan || inactivityThreshold) {
      const todos = todoStore?.getTodosByConversation(sessionState.conversationId);
      const snapshot = todos ? buildCompactTaskSnapshot(todos, todoStore) : null;
      // 运行时派生视图（Ready/In Progress/Blocked）——从 Scheduler 单一来源，不重复实现就绪判定
      const runtimeOverlay = config.scheduler && todos && todos.length > 0
        ? buildRuntimeOverlay(config.scheduler)
        : null;
      const snapshotText = snapshot ? (runtimeOverlay ? `${snapshot}\n${runtimeOverlay}` : snapshot) : null;
      if (snapshotText) {
        const prefix = revisionChanged
          ? '[任务状态已更新]'
          : compactionJustRan
            ? '[上下文已压缩，当前任务状态]'
            : '[任务提醒]';
        messages = [...messages, {
          role: 'user',
          content: `${prefix}\n${snapshotText}`,
        } as ModelMessageType];
        debugLog(debugEnabled, `[Agent] Task snapshot injected: revision=${currentRevision} changed=${revisionChanged} compact=${compactionJustRan} inactive=${inactivityThreshold}`);
      } else if (inactivityThreshold) {
        // Phase A 兜底：干了几步仍未建单 → 注入提醒（不预判是否多步，由模型再判断；
        // 此前 todo 为空时此路径是死的）
        messages = [...messages, {
          role: 'user',
          content: buildEmptyTodoReminder(),
        } as ModelMessageType];
        debugLog(debugEnabled, `[Agent] Empty todo + 5 steps inactive, injected reminder`);
      }
      sessionState.lastTodoRevision = currentRevision;
      sessionState.stepsSinceTodoMutation = 0;
    }

    // ── Completion Audit ──
    // quiescent（无 ready / 无 in_progress / 无待归档）后，让模型判 complete/continue/blocked/replan。
    // 不直接宣告完成——quiescent ≠ Goal 完成。latch 防重复注入（busy-loop）。
    const scheduler = config.scheduler;
    if (scheduler && stepNumber > 0) {
      const runtime = scheduler.getRuntimeState();
      const goalActive = !!sessionState.goalState && shouldContinue(sessionState.goalState);
      if (runtime.quiescent && !sessionState.aborted && !goalActive && !sessionState.completionAuditInjected) {
        sessionState.completionAuditInjected = true;
        messages = [...messages, {
          role: 'user',
          content: buildCompletionAuditPrompt(runtime, sessionState.goalState?.objective),
        } as ModelMessageType];
        debugLog(debugEnabled, `[Agent] Completion Audit injected (quiescent)`);
      }
    }

    // Context usage progress bar + 闸门(复用同一次估算,零新增开销)
    // 估算用 estimateRequestBudget:含校准 buffer + 策略触发线,UI TRIGGER 与真实升档一致
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
      // 记录输入侧估算(排除输出预留),下一步收到真实 usage 时配对校准(见主文档 F)
      sessionState.tokenBudget.recordEstimate(estimation.totalTokens - estimation.outputReserve);
      // 缓存估算结果,供 onStepEnd 推送前端当前窗口占用 + 明细
      sessionState.lastEstimation = estimation;

      // 不静默发超标请求出去被 provider 拒。pre-stream 闸门见 create.ts;此处覆盖运行中增长。
      // 硬不变量:含校准 buffer 的总量超过窗口上限才拒绝;达触发线(shouldTrigger)由 manageCompaction 负责升档压缩。
      if (estimation.exceedsLimitWithBuffer) {
        const reason = `msgs=${estimation.messagesTokens}+inst=${estimation.instructionsTokens}+tools=${estimation.toolsTokens}+out=${estimation.outputReserve}+buf=${estimation.tokenizerBuffer} = ${estimation.totalTokensWithBuffer} > ${estimation.modelLimit}`;
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
