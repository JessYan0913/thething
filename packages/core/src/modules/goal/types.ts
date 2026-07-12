// ============================================================
// Goal Types - 目标驱动持续执行的类型定义
// ============================================================

/**
 * 目标状态
 */
export type GoalStatus = 'active' | 'paused' | 'complete' | 'blocked' | 'budget_limited' | 'max_turns'

/**
 * 目标状态
 */
export interface GoalState {
  /** 目标 ID */
  id: string
  /** 目标描述 */
  objective: string
  /** 状态 */
  status: GoalStatus
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
  /** 已执行轮次 */
  turnsExecuted: number
  /** 已使用 token */
  tokensUsed: number
  /** Token 预算上限（null 表示无限制） */
  tokenBudget: number | null
  /** 阻塞原因 */
  blockedReason?: string
  /** 连续相同阻塞计数 */
  blockedCount: number
  /** 上一次阻塞原因（用于检测变化） */
  lastBlockReason?: string
}

/**
 * 目标创建输入
 */
export interface GoalCreateInput {
  objective: string
  tokenBudget?: number | null
}

/**
 * 目标更新输入
 */
export interface GoalUpdateInput {
  objective?: string
  status?: GoalStatus
  turnsExecuted?: number
  tokensUsed?: number
  tokenBudget?: number | null
  blockedReason?: string
}

/**
 * 目标工具输入（Agent 调用）
 */
export interface GoalToolInput {
  action: 'set' | 'complete' | 'blocked' | 'status'
  objective?: string
  reason?: string
}

/**
 * 目标工具输出
 */
export interface GoalToolOutput {
  success: boolean
  goal?: GoalState
  message: string
}

// ============================================================
// 常量
// ============================================================

/** 最大自动继续轮次 */
export const MAX_GOAL_TURNS = 150

/** 阻塞连续阈值 */
export const BLOCKED_CONSECUTIVE_THRESHOLD = 3

/** 目标描述最大长度 */
export const MAX_OBJECTIVE_CHARS = 4000

/** 显示截断长度 */
export const MAX_DISPLAY_CHARS = 80
