// ============================================================
// Goal Tool - 模型可调用的目标工具
// ============================================================
// 职责：让模型能显式声明目标的 set / complete / blocked / status。
// 决策归模型（goal-prompts 的 Completion Audit / Blocked Audit 引导）：
// - complete → GoalState.status = complete（终止 continuation loop，触发 Task End）
// - blocked  → GoalState.status = blocked（触发 goalBlocked 停止条件）
// - set      → 设置/更新目标为 active
// - status   → 只读当前目标状态
//
// 本工具只改写 sessionState.goalState（内存态，与 pipeline 的 goal 注入同一来源），
// 不在此做持久化（goal-storage 由上层按需调用）。

import { tool } from 'ai'
import { z } from 'zod'
import type { GoalState } from './types'
import { setGoal, completeGoal } from './goal-state'

export const goalToolSchema = z.object({
  /** 目标操作 */
  action: z.enum(['set', 'complete', 'blocked', 'status'])
    .describe('Goal action: set=创建/更新目标; complete=标记完成; blocked=标记阻塞; status=读取状态'),
  /** set 时的目标描述（objective） */
  objective: z.string().max(4000).optional()
    .describe('Objective string. Required when action=set.'),
  /** complete / blocked 时的理由/说明 */
  reason: z.string().optional()
    .describe('Reason for complete/blocked (optional).'),
})

export type GoalToolInput = z.infer<typeof goalToolSchema>

export type GoalToolOutput = {
  success: boolean
  goal?: GoalState
  message: string
}

/**
 * 创建一个 GoalTool，通过一个取/设函数读写 sessionState.goalState。
 *
 * @param getGoal - 返回当前 goal（sessionState.goalState）
 * @param setGoalState - 更新 goal（写回 sessionState.goalState）
 */
export function createGoalTool(opts: {
  getGoal: () => GoalState | null
  setGoalState: (g: GoalState | null) => void
}) {
  const { getGoal, setGoalState } = opts
  return tool({
    description: `Declare/update the current autonomous goal. Use it to:
- set: establish or refresh an active objective the agent should keep working toward.
- complete: mark the goal achieved (only after a strict Completion Audit per the goal-steering prompt).
- blocked: mark the goal blocked (only when genuinely stuck, per the Blocked Audit rules).
- status: read the current goal state.`,
    inputSchema: goalToolSchema,
    execute: async (input: GoalToolInput): Promise<GoalToolOutput> => {
      const current = getGoal()
      switch (input.action) {
        case 'set': {
          if (!input.objective) {
            return { success: false, message: 'objective is required for action=set.' }
          }
          const updated = setGoal(input.objective, current)
          setGoalState(updated)
          return { success: true, goal: updated, message: `Goal set: ${updated.objective.slice(0, 80)}` }
        }
        case 'complete': {
          if (!current) {
            return { success: false, message: 'No active goal to complete. Use action=set first.' }
          }
          const updated = completeGoal(current)
          setGoalState(updated)
          return { success: true, goal: updated, message: `Goal marked complete${input.reason ? `: ${input.reason}` : ''}` }
        }
        case 'blocked': {
          if (!current) {
            return { success: false, message: 'No active goal to block. Use action=set first.' }
          }
          const updated: GoalState = {
            ...current,
            status: 'blocked',
            blockedReason: input.reason,
            updatedAt: Date.now(),
          }
          setGoalState(updated)
          return { success: true, goal: updated, message: `Goal marked blocked${input.reason ? `: ${input.reason}` : ''}` }
        }
        case 'status': {
          if (!current) {
            return { success: false, message: 'No active goal.', goal: undefined }
          }
          return { success: true, goal: current, message: `goal.status = ${current.status}` }
        }
        default: {
          return { success: false, message: `Unknown action: ${(input as GoalToolInput).action}` }
        }
      }
    },
    // 以纯文本形式发送给模型，避免 goal 对象经 JSON 序列化时的转义开销。
    // 模型面只需 message（一次性）；结构化 goal 保留给画布消费。
    // 见 docs/compaction-redesign.md
    toModelOutput: ({ output }) => {
      if (!output || typeof output !== 'object') {
        return { type: 'text' as const, value: '' }
      }
      const r = output as Record<string, unknown>
      if (r.success === false) {
        const message = typeof r.message === 'string' ? r.message : 'goal operation failed'
        return { type: 'text' as const, value: `❌ ${message}` }
      }
      const message = typeof r.message === 'string' ? r.message : ''
      return { type: 'text' as const, value: message || '(goal updated)' }
    },
  })
}
