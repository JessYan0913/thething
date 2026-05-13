// ============================================================
// Approval Context - 挂起/恢复式审批状态管理（纯内存实现）
// ============================================================
// 设计原则：
// 1. 挂起时保存完整的 ModelMessage 执行现场，而非"已批准工具名"
// 2. 恢复时直接在现场追加 tool-approval-response，无需从头重跑 Agent
// 3. 避免 LLM 非确定性重跑导致的参数不一致和循环审批问题
//
// 流程：
//   工具需要审批 → setSuspendedState(现场 + 累积结果) → 返回询问消息
//   用户回复同意 → getSuspendedState() → 在现场追加 approval-response → 继续运行

import type { ReplyAddress } from './inbound/types'

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

const suspendedStates = new Map<string, SuspendedAgentState>()

// ============================================================
// Suspended State Management
// ============================================================

export function setSuspendedState(conversationId: string, state: SuspendedAgentState): void {
  suspendedStates.set(conversationId, state)
  console.log('[ApprovalContext] Suspended agent state saved:', conversationId, state.pendingApprovals.map(item => item.toolName))
}

export function getSuspendedState(conversationId: string): SuspendedAgentState | null {
  const state = suspendedStates.get(conversationId)
  if (!state) return null

  if (Date.now() - state.createdAt > SUSPENDED_TTL_MS) {
    suspendedStates.delete(conversationId)
    console.log('[ApprovalContext] Suspended state expired:', conversationId)
    return null
  }

  return state
}

export function clearSuspendedState(conversationId: string): void {
  suspendedStates.delete(conversationId)
  console.log('[ApprovalContext] Cleared suspended state:', conversationId)
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
  console.log('[ApprovalContext] Cleared all suspended states')
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
    console.log('[ApprovalContext] Cleaned up expired suspended states:', count)
  }
}
