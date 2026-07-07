// ============================================================
// Approval Context - 挂起/恢复式审批状态管理
// ============================================================
// 设计原则：
// 1. 挂起时保存完整的 ModelMessage 执行现场，而非"已批准工具名"
// 2. 恢复时直接在现场追加 tool-approval-response，无需从头重跑 Agent
// 3. 避免 LLM 非确定性重跑导致的参数不一致和循环审批问题
// 4. 支持跨重启恢复：使用 SQLite 持久化执行现场
//
// 流程：
//   工具需要审批 → setSuspendedState(现场 + 累积结果) → 返回询问消息
//   用户回复同意 → getSuspendedState() → 在现场追加 approval-response → 继续运行

import type { ReplyAddress } from '../../modules/connector/inbound/types'
import type { SuspendedStateStore } from '../../primitives/datastore/types'
import { logger } from '../../primitives/logger'

export interface SuspendedApprovalRequest {
  approvalId: string
  toolCallId: string
  toolName: string
  toolInput: Record<string, unknown>
}

/**
 * 挂起的 Agent 执行现场
 */
export interface SuspendedAgentState {
  conversationId: string
  connectorEventId?: string
  replyAddress: ReplyAddress
  /** 挂起时的 ModelMessage 数组（已含 tool-call + tool-approval-request，不含 approval-response） */
  pausedModelMessages: unknown[]
  /** 需要审批的工具信息 */
  pendingApprovals: SuspendedApprovalRequest[]
  /** 挂起前累积的执行结果（用于恢复后合并） */
  allSteps: unknown[]
  responseText: string
  writtenFiles: Array<{ path: string; content: string }>
  /** 本 session 中用户已批准的工具名集合（用于 resume 时跳过重复审批） */
  approvedTools: string[]
  /** 用于 Web UI 展示的对话 ID（approval-ask 消息的 ID） */
  approvalAskMessageId: string
  /** 创建时间（用于过期清理，5 分钟 TTL） */
  createdAt: number
}

const SUSPENDED_TTL_MS = 5 * 60 * 1000

// 内存缓存（快速访问） + SQLite 持久化（跨重启恢复）
const suspendedStates = new Map<string, SuspendedAgentState>()

// 全局 store 引用，由 initializeApprovalContext 设置
let suspendedStateStore: SuspendedStateStore | null = null

/**
 * 初始化 Approval Context，绑定 SQLite 存储
 */
export function initializeApprovalContext(store: SuspendedStateStore): void {
  suspendedStateStore = store
  // 启动时清理过期状态
  cleanupExpiredFromDb()
  // 从数据库恢复未过期的状态到内存
  restoreStatesFromDb()
}

/**
 * 从数据库恢复状态到内存
 */
function restoreStatesFromDb(): void {
  if (!suspendedStateStore) return
  
  try {
    const conversationIds = suspendedStateStore.getConversationsWithSuspendedStates()
    for (const conversationId of conversationIds) {
      const row = suspendedStateStore.getSuspendedState(conversationId)
      if (row) {
        try {
          const state = JSON.parse(row.state) as SuspendedAgentState
          // 恢复 Date 对象
          state.createdAt = new Date(row.createdAt).getTime()
          suspendedStates.set(conversationId, state)
          logger.debug('ApprovalContext', `Restored suspended state from DB: ${conversationId}`)
        } catch (e) {
          logger.error('ApprovalContext', `Failed to parse suspended state for ${conversationId}:`, e)
          suspendedStateStore.clearSuspendedState(conversationId)
        }
      }
    }
  } catch (e) {
    logger.error('ApprovalContext', 'Failed to restore suspended states from DB:', e)
  }
}

/**
 * 从数据库清理过期状态
 */
function cleanupExpiredFromDb(): void {
  if (!suspendedStateStore) return
  
  try {
    const cleaned = suspendedStateStore.cleanupExpiredStates()
    if (cleaned > 0) {
      logger.debug('ApprovalContext', `Cleaned up ${cleaned} expired states from DB`)
    }
  } catch (e) {
    logger.error('ApprovalContext', 'Failed to cleanup expired states from DB:', e)
  }
}

// ============================================================
// Suspended State Management
// ============================================================

export function setSuspendedState(conversationId: string, state: SuspendedAgentState): void {
  // 保存到内存
  suspendedStates.set(conversationId, state)
  
  // 持久化到 SQLite
  if (suspendedStateStore) {
    try {
      const expiresAt = new Date(state.createdAt + SUSPENDED_TTL_MS)
      suspendedStateStore.saveSuspendedState(
        conversationId,
        JSON.stringify(state),
        new Date(state.createdAt),
        expiresAt
      )
      logger.debug('ApprovalContext', `Suspended agent state saved to DB: ${conversationId} ${state.pendingApprovals.map(item => item.toolName).join(', ')}`)
    } catch (e) {
      logger.error('ApprovalContext', `Failed to save suspended state to DB for ${conversationId}:`, e)
    }
  } else {
    logger.debug('ApprovalContext', `Suspended agent state saved (memory only): ${conversationId} ${state.pendingApprovals.map(item => item.toolName).join(', ')}`)
  }
}

export function getSuspendedState(conversationId: string): SuspendedAgentState | null {
  // 先从内存获取
  const state = suspendedStates.get(conversationId)
  if (state) {
    // 检查内存中的过期
    if (Date.now() - state.createdAt > SUSPENDED_TTL_MS) {
      suspendedStates.delete(conversationId)
      if (suspendedStateStore) {
        suspendedStateStore.clearSuspendedState(conversationId)
      }
      logger.debug('ApprovalContext', `Suspended state expired (memory): ${conversationId}`)
      return null
    }
    return state
  }
  
  // 内存中没有，尝试从数据库恢复
  if (suspendedStateStore) {
    try {
      const row = suspendedStateStore.getSuspendedState(conversationId)
      if (row) {
        const dbState = JSON.parse(row.state) as SuspendedAgentState
        dbState.createdAt = new Date(row.createdAt).getTime()
        
        // 检查数据库中的过期
        if (Date.now() - dbState.createdAt > SUSPENDED_TTL_MS) {
          suspendedStateStore.clearSuspendedState(conversationId)
          logger.debug('ApprovalContext', `Suspended state expired (DB): ${conversationId}`)
          return null
        }
        
        // 恢复到内存缓存
        suspendedStates.set(conversationId, dbState)
        logger.debug('ApprovalContext', `Restored suspended state from DB on demand: ${conversationId}`)
        return dbState
      }
    } catch (e) {
      logger.error('ApprovalContext', `Failed to restore suspended state from DB for ${conversationId}:`, e)
    }
  }
  
  return null
}

export function clearSuspendedState(conversationId: string): void {
  // 清除内存
  suspendedStates.delete(conversationId)
  
  // 清除数据库
  if (suspendedStateStore) {
    try {
      suspendedStateStore.clearSuspendedState(conversationId)
      logger.debug('ApprovalContext', `Cleared suspended state from DB: ${conversationId}`)
    } catch (e) {
      logger.error('ApprovalContext', `Failed to clear suspended state from DB for ${conversationId}:`, e)
    }
  } else {
    logger.debug('ApprovalContext', `Cleared suspended state (memory only): ${conversationId}`)
  }
}

export function hasSuspendedState(conversationId: string): boolean {
  return getSuspendedState(conversationId) !== null
}

// ============================================================
// Approval Response Detection
// ============================================================

const APPROVE_KEYWORDS = ['同意', '允许', '批准', '确认', 'ok', 'yes', '好', '行', '可以', '是的', '没问题']
const DENY_KEYWORDS = ['拒绝', '不同意', '禁止', '取消', 'no', '不行', '不要', 'deny']

export function detectApprovalResponse(text: string): {
  isApprove: boolean
  isDeny: boolean
  isApprovalResponse: boolean
} {
  const lower = text.toLowerCase().trim()
  const isApprove = APPROVE_KEYWORDS.some(k => lower.includes(k))
  const isDeny = DENY_KEYWORDS.some(k => lower.includes(k))
  return { isApprove, isDeny, isApprovalResponse: isApprove || isDeny }
}

// ============================================================
// Cleanup
// ============================================================

export function clearAllSuspendedStates(): void {
  suspendedStates.clear()
  logger.debug('ApprovalContext', 'Cleared all suspended states (memory)')
}

export function cleanupExpiredSuspendedStates(): void {
  const now = Date.now()
  let count = 0
  for (const [key, state] of suspendedStates.entries()) {
    if (now - state.createdAt > SUSPENDED_TTL_MS) {
      suspendedStates.delete(key)
      count++
    }
  }
  if (count > 0) {
    logger.debug('ApprovalContext', `Cleaned up expired suspended states (memory): ${count}`)
  }
  
  // 同时清理数据库中的过期状态
  cleanupExpiredFromDb()
}
