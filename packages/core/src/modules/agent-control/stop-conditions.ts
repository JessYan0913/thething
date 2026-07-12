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