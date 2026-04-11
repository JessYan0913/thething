import { hasToolCall, stepCountIs, type StopCondition, type ToolSet } from 'ai';
import type { CostTracker } from '../session-state/cost';
import type { SessionState } from '../session-state/state';
import type { DenialTracker } from './denial-tracking';

export function costBudgetExceeded<TOOLS extends ToolSet>(costTracker: CostTracker): StopCondition<TOOLS> {
  return () => {
    return costTracker.isOverBudget;
  };
}

export function denialThresholdExceeded<TOOLS extends ToolSet>(denialTracker: DenialTracker): StopCondition<TOOLS> {
  return () => {
    return denialTracker.isThresholdExceeded();
  };
}

export function isAborted<TOOLS extends ToolSet>(sessionState: SessionState): StopCondition<TOOLS> {
  return () => {
    return sessionState.aborted;
  };
}

export function createDefaultStopConditions<TOOLS extends ToolSet>(
  costTracker: CostTracker,
  options?: {
    maxSteps?: number;
    denialTracker?: DenialTracker;
    sessionState?: SessionState;
  },
) {
  const { maxSteps = 50, denialTracker, sessionState } = options ?? {};

  const stopWhen: StopCondition<TOOLS>[] = [
    stepCountIs(maxSteps),
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