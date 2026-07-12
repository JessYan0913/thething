// ============================================================
// Goal Module - 目标驱动持续执行
// ============================================================

// Types
export type {
  GoalState,
  GoalStatus,
  GoalCreateInput,
  GoalUpdateInput,
  GoalToolInput,
  GoalToolOutput,
} from './types'

export {
  MAX_GOAL_TURNS,
  BLOCKED_CONSECUTIVE_THRESHOLD,
  MAX_OBJECTIVE_CHARS,
  MAX_DISPLAY_CHARS,
} from './types'

// State machine (pure functions)
export {
  setGoal,
  clearGoal,
  pauseGoal,
  resumeGoal,
  completeGoal,
  incrementTurns,
  updateTokens,
  recordBlocked,
  continueFromMaxTurns,
  checkMaxTurns,
  shouldContinue,
  formatGoalStatusLabel,
  formatGoalElapsed,
  getActiveElapsedMs,
  truncateForDisplay,
} from './goal-state'

// Storage
export {
  persistGoal,
  loadGoal,
  clearGoalStorage,
} from './goal-storage'

// Prompts
export {
  buildContinuationPrompt,
  buildBudgetLimitPrompt,
  buildObjectiveUpdatedPrompt,
  buildGoalContextBlock,
  buildMaxTurnsPrompt,
} from './goal-prompts'
