// ============================================================
// Goal State - 纯函数状态机
// ============================================================

import type { GoalState, GoalStatus } from './types'
import {
  MAX_GOAL_TURNS,
  BLOCKED_CONSECUTIVE_THRESHOLD,
  MAX_DISPLAY_CHARS,
} from './types'

/**
 * 创建新目标
 */
export function setGoal(
  objective: string,
  existing?: GoalState | null,
): GoalState {
  const now = Date.now()
  return {
    id: existing?.id ?? crypto.randomUUID(),
    objective,
    status: 'active',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    turnsExecuted: existing ? existing.turnsExecuted + 1 : 1,
    tokensUsed: existing?.tokensUsed ?? 0,
    tokenBudget: existing?.tokenBudget ?? null,
    blockedCount: 0,
    lastBlockReason: undefined,
  }
}

/**
 * 清除目标
 */
export function clearGoal(goal: GoalState): GoalState {
  return {
    ...goal,
    status: 'complete',
    updatedAt: Date.now(),
  }
}

/**
 * 暂停目标
 */
export function pauseGoal(goal: GoalState): GoalState {
  if (goal.status !== 'active') return goal
  return {
    ...goal,
    status: 'paused',
    updatedAt: Date.now(),
  }
}

/**
 * 恢复目标
 */
export function resumeGoal(goal: GoalState): GoalState {
  if (goal.status !== 'paused') return goal
  return {
    ...goal,
    status: 'active',
    updatedAt: Date.now(),
  }
}

/**
 * 标记目标完成
 */
export function completeGoal(goal: GoalState): GoalState {
  return {
    ...goal,
    status: 'complete',
    updatedAt: Date.now(),
  }
}

/**
 * 增加轮次计数
 */
export function incrementTurns(goal: GoalState): GoalState {
  return {
    ...goal,
    turnsExecuted: goal.turnsExecuted + 1,
    updatedAt: Date.now(),
  }
}

/**
 * 更新 token 使用量
 * 如果超预算，自动转换为 budget_limited 状态
 */
export function updateTokens(goal: GoalState, used: number): GoalState {
  const tokensUsed = goal.tokensUsed + used
  const newGoal = {
    ...goal,
    tokensUsed,
    updatedAt: Date.now(),
  }

  if (goal.tokenBudget !== null && tokensUsed >= goal.tokenBudget) {
    newGoal.status = 'budget_limited'
  }

  return newGoal
}

/**
 * 记录阻塞尝试
 * 同一原因连续 3 次才标记为 blocked
 */
export function recordBlocked(goal: GoalState, reason: string): GoalState {
  const sameReason = goal.lastBlockReason === reason
  const blockedCount = sameReason ? goal.blockedCount + 1 : 1

  const newGoal: GoalState = {
    ...goal,
    blockedCount,
    lastBlockReason: reason,
    updatedAt: Date.now(),
  }

  if (blockedCount >= BLOCKED_CONSECUTIVE_THRESHOLD) {
    newGoal.status = 'blocked'
    newGoal.blockedReason = reason
  }

  return newGoal
}

/**
 * 从 max_turns 状态继续
 * 重置轮次计数器
 */
export function continueFromMaxTurns(goal: GoalState): GoalState {
  if (goal.status !== 'max_turns') return goal
  return {
    ...goal,
    status: 'active',
    turnsExecuted: 0,
    updatedAt: Date.now(),
  }
}

/**
 * 检查是否达到最大轮次
 * 如果达到，自动转换为 max_turns 状态
 */
export function checkMaxTurns(goal: GoalState): GoalState {
  if (goal.status !== 'active') return goal
  if (goal.turnsExecuted >= MAX_GOAL_TURNS) {
    return {
      ...goal,
      status: 'max_turns',
      updatedAt: Date.now(),
    }
  }
  return goal
}

/**
 * 判断目标是否应该继续执行
 */
export function shouldContinue(goal: GoalState | null): boolean {
  if (!goal) return false
  return goal.status === 'active'
}

/**
 * 格式化目标状态标签
 */
export function formatGoalStatusLabel(status: GoalStatus): string {
  switch (status) {
    case 'active':
      return 'Active'
    case 'paused':
      return 'Paused'
    case 'complete':
      return 'Complete'
    case 'blocked':
      return 'Blocked'
    case 'budget_limited':
      return 'Budget Limited'
    case 'max_turns':
      return 'Max Turns Reached'
    default:
      return status
  }
}

/**
 * 格式化已用时间
 */
export function formatGoalElapsed(goal: GoalState): string {
  const elapsedMs = Date.now() - goal.createdAt
  const seconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

/**
 * 获取活跃时间（毫秒）
 */
export function getActiveElapsedMs(goal: GoalState): number {
  return Date.now() - goal.createdAt
}

/**
 * 截断目标用于显示
 */
export function truncateForDisplay(objective: string): string {
  const firstLine = objective.split('\n')[0] ?? objective
  if (firstLine.length <= MAX_DISPLAY_CHARS) return firstLine
  return firstLine.slice(0, MAX_DISPLAY_CHARS) + '…'
}
