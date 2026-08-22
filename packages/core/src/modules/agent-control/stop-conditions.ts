import { hasToolCall, isStepCount, type StopCondition, type ToolSet } from 'ai';
import type { CostTracking } from '../session/interfaces';
import type { DenialTracking } from '../session/interfaces';
import type { GoalState } from '../goal/types';

export function costBudgetExceeded<TOOLS extends ToolSet>(costTracker: CostTracking): StopCondition<TOOLS> {
  return () => {
    return costTracker.isOverBudget;
  };
}

export function denialThresholdExceeded<TOOLS extends ToolSet>(denialTracker: DenialTracking): StopCondition<TOOLS> {
  return () => {
    return denialTracker.isThresholdExceeded();
  };
}

export function isAborted<TOOLS extends ToolSet>(target: { aborted: boolean }): StopCondition<TOOLS> {
  return () => {
    return target.aborted;
  };
}

export function goalBudgetExceeded<TOOLS extends ToolSet>(goalState: GoalState | null): StopCondition<TOOLS> {
  return () => {
    if (!goalState) return false;
    return goalState.status === 'budget_limited';
  };
}

export function goalMaxTurnsReached<TOOLS extends ToolSet>(goalState: GoalState | null): StopCondition<TOOLS> {
  return () => {
    if (!goalState) return false;
    return goalState.status === 'max_turns';
  };
}

export function goalBlocked<TOOLS extends ToolSet>(goalState: GoalState | null): StopCondition<TOOLS> {
  return () => {
    if (!goalState) return false;
    return goalState.status === 'blocked';
  };
}

/**
 * pi 截断批次毒化（2026-08-22，见 docs/pi 对齐）：某一步以 finishReason='length'
 * 收尾且该步含工具调用 → 整批参数可能不完整（长 JSON args 被掐半截），立即停推。
 * 学 pi agent-loop.ts：stopReason==='length' 时所有工具调用视为有毒、全部作废重发；
 * SDK 对截断参数的调用本身会因 JSON 不完整被 invalid 过滤（不会执行），
 * 但"length 后的循环继续推进"会把截断意图吞掉 → 此处主动停推，
 * run 终态落 output_truncated（或一次性 auto-retry 重跑这段）。
 */
export function stopOnTruncatedToolBatch<TOOLS extends ToolSet>(): StopCondition<TOOLS> {
  return ({ steps }) => {
    const last = steps[steps.length - 1];
    if (!last) return false;
    return last.finishReason === 'length' && (last.toolCalls?.length ?? 0) > 0;
  };
}

export function createDefaultStopConditions<TOOLS extends ToolSet>(
  costTracker: CostTracking,
  options?: {
    maxSteps?: number;
    denialTracker?: DenialTracking;
    sessionState?: { aborted: boolean };
    goalState?: GoalState | null;
  },
) {
  const { maxSteps = 50, denialTracker, sessionState, goalState } = options ?? {};

  const stopWhen: StopCondition<TOOLS>[] = [
    isStepCount(maxSteps),
    costBudgetExceeded(costTracker),
    hasToolCall('done'),
    // 截断批次毒化：length+工具调用即停推（见 stopOnTruncatedToolBatch 注释）
    stopOnTruncatedToolBatch(),
  ];

  if (denialTracker) {
    stopWhen.splice(2, 0, denialThresholdExceeded(denialTracker));
  }

  if (sessionState) {
    stopWhen.push(isAborted(sessionState));
  }

  // Goal 相关停止条件
  if (goalState) {
    stopWhen.push(goalBudgetExceeded(goalState));
    stopWhen.push(goalMaxTurnsReached(goalState));
    stopWhen.push(goalBlocked(goalState));
  }

  return stopWhen;
}