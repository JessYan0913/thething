// ============================================================
// Run Finalization — 统一 Run 收尾器(One Close)
// ============================================================
// 确定性收尾:每次终止都用推导出的 StopReason 落下 agent_runs 终态,
// 并把未结账的 in_progress todo 确定性回卷为 pending(机器回卷,不调 LLM)。
//
// 本设计由 docs/runtime.md「One Close」主导:
// - 不做任何 LLM 审问(删 settle / completion audit / 归档提炼)。
// - 无用模块级守卫(finalizedConversations)——由幂等 UPDATE 保证幂等。
// - 终止原因推导是纯函数 deriveStopReason,可靠、可测。
// - in_progress → pending 回卷由系统确定性完成,避免"面板幻影"与
//   单选 in_progress 锁死下一轮 claim 的死锁。

import type { DataStore } from '../../primitives/datastore/types';
import type { GoalState } from '../goal/types';
import type { Todo } from '../todos/types';
import { withTodoReason } from '../todos';
import { logger } from '../../primitives/logger';

/** Run 终止原因——决定 agent_runs 终态是 completed / exhausted / failed */
export type StopReason =
  | 'done'
  | 'quiescent'
  | 'step_limit'
  | 'cost_budget'
  | 'context_budget'
  | 'denial_limit'
  | 'goal_budget'
  | 'goal_max_turns'
  | 'goal_blocked'
  | 'aborted'
  | 'budget_exception'
  | 'output_truncated'
  | 'error';

export type AgentRunStatus = 'completed' | 'exhausted' | 'failed';

/** 终止原因 → 终态。exhausted ≠ completed:护栏/中断/异常一律不伪装成完成。 */
export function determineRunStatus(reason: StopReason): AgentRunStatus {
  switch (reason) {
    case 'done':
    case 'quiescent':
      return 'completed';
    case 'step_limit':
    case 'cost_budget':
    case 'context_budget':
    case 'denial_limit':
    case 'goal_budget':
    case 'goal_max_turns':
    case 'goal_blocked':
    case 'aborted':
    case 'budget_exception':
      return 'exhausted';
    case 'output_truncated':
    case 'error':
      return 'failed';
  }
}

/** finalizeRun 所需的 sessionState 数据子集(Web/Connector 的真实 SessionState 均满足) */
export interface RunFinalizationState {
  turnCount: number;
  aborted: boolean;
  /** pipeline 在闸门受控终止时设置的提示(如 context_budget),优先于状态推导 */
  exhaustedHint?: StopReason;
  /** One Canvas 闸门标志：pipeline 预算超限时置位（不再抛异常杀流），finalize 据此落 exhausted(context_budget) */
  exhaustFlag?: 'context_budget' | 'adaptive';
  costTracker: { isOverBudget: boolean };
  denialTracker: { isThresholdExceeded(): boolean };
  goalState: GoalState | null;
}

export interface FinalizeRunOptions {
  dataStore: DataStore;
  conversationId: string;
  /** 推导终止原因所需的 harness 状态 */
  sessionState: RunFinalizationState;
  /** behavior.maxStepsPerSession——step_limit 阈值 */
  maxSteps: number;
  /** 由 isOutputTruncated(finishReason) 计算(finishReason==='length') */
  truncated?: boolean;
  /** 显式指定的终止原因(异常/超时/刻意取消等路径),优先于状态推导 */
  forcedReason?: StopReason;
  /** 终止原因出现时的错误信息(failed 时写入 error;exhausted/completed 忽略) */
  errorMessage?: string;
  /** UI 同步钩子:机器回卷 in_progress→pending 后调用一次(非 LLM、可选) */
  pushTodoUpdate?: (todos: Todo[]) => void;
}

export interface DeriveStopReasonInput {
  forcedReason?: StopReason;
  exhaustedHint?: StopReason;
  /** One Canvas 闸门标志（预算超限），等价于 exhaustedHint='context_budget' */
  exhaustFlag?: 'context_budget' | 'adaptive';
  aborted: boolean;
  turnCount: number;
  maxSteps: number;
  truncated: boolean;
  overBudget: boolean;
  denialExceeded: boolean;
  goalState: GoalState | null;
}

/** 纯函数:由 harness 状态确定性推导终止原因。 */
export function deriveStopReason(input: DeriveStopReasonInput): StopReason {
  const {
    forcedReason,
    exhaustedHint,
    exhaustFlag,
    aborted,
    turnCount,
    maxSteps,
    truncated,
    overBudget,
    denialExceeded,
    goalState,
  } = input;
  if (forcedReason) return forcedReason;
  if (exhaustedHint) return exhaustedHint;
  if (exhaustFlag === 'context_budget') return 'context_budget';
  if (aborted) return 'aborted';
  if (turnCount >= maxSteps) return 'step_limit';
  if (overBudget) return 'cost_budget';
  if (denialExceeded) return 'denial_limit';
  if (goalState) {
    const st = goalState.status;
    if (st === 'budget_limited') return 'goal_budget';
    if (st === 'max_turns') return 'goal_max_turns';
    if (st === 'blocked') return 'goal_blocked';
  }
  return truncated ? 'output_truncated' : 'done';
}

/**
 * 机器回卷:run 结束后仍为 in_progress 的 todo 确定性置回 pending、
 * 清 claimedBy,并在 metadata.execution 记录中断现场(interruptedAt/interruptedReason)。
 * 收尾对称化(T4):降级后的行 = pending + claimedBy=null + interrupted 现场,可再次 claim。
 * 不调用 LLM,不做"完成/失败"判断(那是模型的权利)。返回被回卷的 todo 列表(供 UI 同步)。
 */
export function downgradeUnsettledInProgress(
  dataStore: DataStore,
  conversationId: string,
  reason: StopReason,
): Todo[] {
  // 写方标注 reason='run-downgrade'（docs/todos-lite.md §5.5）；幂等：重复收尾仅多一条同态快照事件，终态一致
  return withTodoReason(dataStore.todoStore, 'run-downgrade', () => {
    const todos = dataStore.todoStore.getTodosByConversation(conversationId);
    const changed: Todo[] = [];
    for (const t of todos) {
      if (t.status !== 'in_progress') continue;
      const execution = {
        ...((t.metadata as Record<string, unknown> | undefined)?.execution as Record<string, unknown> | undefined),
        interruptedAt: Date.now(),
        interruptedReason: reason,
      };
      const updated = dataStore.todoStore.updateTodo({
        id: t.id,
        status: 'pending',
        claimedBy: null,
        metadata: { ...((t.metadata as Record<string, unknown>) ?? {}), execution },
      });
      if (updated) changed.push(updated);
    }
    if (changed.length > 0) {
      logger.info('RunFinalization', `[downgrade] conversation=${conversationId} ${changed.length} in_progress todo(s) reset to pending (reason=${reason})`);
    }
    return changed;
  });
}

/**
 * 统一 Run 收尾。任何终止路径(正常 done / 步数 / 预算 / 中断 / 异常 / 截断)调用一次,
 * 保证 run 落下确定终态 + in_progress 机器回卷。
 *
 * 幂等性:agent_runs 的 completeRun/exhaustRun/failRun 与 todo 回卷均为幂等 UPDATE,
 * 同一路径重复调用不会产生副作用(不再依赖进程级 Set)。
 */
export async function finalizeRun(opts: FinalizeRunOptions): Promise<{
  reason: StopReason;
  status: AgentRunStatus;
  downgraded: number;
}> {
  const { dataStore, conversationId, sessionState, truncated = false } = opts;

  const reason = deriveStopReason({
    forcedReason: opts.forcedReason,
    exhaustedHint: sessionState.exhaustedHint,
    exhaustFlag: sessionState.exhaustFlag,
    aborted: sessionState.aborted,
    turnCount: sessionState.turnCount,
    maxSteps: opts.maxSteps,
    truncated,
    overBudget: sessionState.costTracker.isOverBudget,
    denialExceeded: sessionState.denialTracker.isThresholdExceeded(),
    goalState: sessionState.goalState,
  });
  const status = determineRunStatus(reason);
  const agentRunStore = dataStore.agentRunStore;

  // 持久化 agent_runs 终态
  switch (status) {
    case 'completed':
      agentRunStore.completeRun(conversationId);
      break;
    case 'exhausted':
      agentRunStore.exhaustRun(conversationId, reason);
      break;
    case 'failed':
      agentRunStore.failRun(conversationId, opts.errorMessage ?? `stop reason: ${reason}`);
      break;
  }

  // 总是回卷未结账的 in_progress(abort/截断/异常路径也跑)
  const downgradedTodos = downgradeUnsettledInProgress(dataStore, conversationId, reason);
  if (downgradedTodos.length > 0 && opts.pushTodoUpdate) {
    opts.pushTodoUpdate(dataStore.todoStore.getTodosByConversation(conversationId));
  }

  logger.info('RunFinalization', `[run-end] conversation=${conversationId} status=${status} reason=${reason} downgraded=${downgradedTodos.length}`);
  return { reason, status, downgraded: downgradedTodos.length };
}