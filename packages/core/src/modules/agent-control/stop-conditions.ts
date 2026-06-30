import { hasToolCall, isStepCount, type StopCondition, type ToolSet } from 'ai';
import type { CostTracking } from '../session/interfaces';
import type { DenialTracking } from '../session/interfaces';

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

export function createDefaultStopConditions<TOOLS extends ToolSet>(
  costTracker: CostTracking,
  options?: {
    maxSteps?: number;
    denialTracker?: DenialTracking;
    sessionState?: { aborted: boolean };
  },
) {
  const { maxSteps = 50, denialTracker, sessionState } = options ?? {};

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

  return stopWhen;
}