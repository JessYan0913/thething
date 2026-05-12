// ============================================================
// Approval Context - 全局审批状态管理（纯内存实现）
// ============================================================
// 用于 Connector 模式下的工具权限征询流程
//
// 设计原则：
// 1. 纯内存实现，审批状态无需持久化（5分钟有效期足够）
// 2. 每个对话同一时间只有一个 pending 审批（Connector 场景为顺序消息）
// 3. 审批 key 基于 conversationId + toolName + 规范化参数，不依赖易变的 toolCallId
//
// 流程：
//   工具需要审批 → setPendingApproval() → 向用户发询问消息
//   用户回复同意 → getPendingApproval() → markToolCallApproved() → clearPendingApproval()
//   Agent 重新执行 → isToolCallApproved() → 自动批准 → 工具正常执行

/**
 * 待审批信息（等待用户通过消息确认）
 */
export interface PendingApprovalInfo {
  /** 工具名称 */
  toolName: string
  /** 工具输入参数 */
  input: Record<string, unknown>
  /** Connector 类型 */
  connectorType: string
  /** 频道 ID */
  channelId: string
  /** 创建时间戳 */
  createdAt: number
}

/**
 * 审批有效期（毫秒）- 5 分钟
 */
const APPROVAL_TTL_MS = 5 * 60 * 1000

/**
 * 待审批 Map: conversationId → PendingApprovalInfo
 * 每个对话同一时间只有一个待审批工具（覆盖旧值）
 */
const pendingApprovals = new Map<string, PendingApprovalInfo>()

/**
 * 已批准的工具调用集合
 * Key: approvalKey (基于 conversationId + toolName + 规范化参数)
 * Value: 审批时间戳（用于过期清理）
 */
const approvedToolCalls = new Map<string, number>()

// ============================================================
// Pending Approval Management（待审批管理）
// ============================================================

/**
 * 设置待审批信息
 * 同一对话只保留最新的一条（旧值被覆盖）
 */
export function setPendingApproval(conversationId: string, info: PendingApprovalInfo): void {
  pendingApprovals.set(conversationId, info)
  console.log('[ApprovalContext] Set pending approval:', conversationId, info.toolName)
}

/**
 * 获取待审批信息（自动过期检查）
 */
export function getPendingApproval(conversationId: string): PendingApprovalInfo | null {
  const info = pendingApprovals.get(conversationId)
  if (!info) return null

  if (Date.now() - info.createdAt > APPROVAL_TTL_MS) {
    pendingApprovals.delete(conversationId)
    console.log('[ApprovalContext] Pending approval expired:', conversationId)
    return null
  }

  return info
}

/**
 * 清除待审批信息
 */
export function clearPendingApproval(conversationId: string): void {
  pendingApprovals.delete(conversationId)
  console.log('[ApprovalContext] Cleared pending approval:', conversationId)
}

/**
 * 检查是否有未过期的待审批信息
 */
export function hasPendingApproval(conversationId: string): boolean {
  return getPendingApproval(conversationId) !== null
}

// ============================================================
// Approved Tool Management（已批准工具管理）
// ============================================================

/**
 * 生成稳定的 approvalKey
 * 使用排序后的 JSON 键，确保相同参数生成相同 key（不依赖键顺序）
 */
export function generateApprovalKey(
  conversationId: string,
  toolName: string,
  input: Record<string, unknown>
): string {
  let keyParams = ''

  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'read_file') {
    keyParams = String(input.filePath || '')
  } else if (toolName === 'bash') {
    keyParams = String(input.command || '').slice(0, 100)
  } else {
    try {
      const sorted = Object.fromEntries(
        Object.entries(input).sort(([a], [b]) => a.localeCompare(b))
      )
      keyParams = JSON.stringify(sorted).slice(0, 200)
    } catch {
      keyParams = ''
    }
  }

  return `${conversationId}:${toolName}:${keyParams}`
}

/**
 * 标记工具调用为已批准
 */
export function markToolCallApproved(
  conversationId: string,
  toolName: string,
  input: Record<string, unknown>
): void {
  const key = generateApprovalKey(conversationId, toolName, input)
  approvedToolCalls.set(key, Date.now())
  console.log('[ApprovalContext] Marked as approved:', key)
  cleanupExpiredApprovals()
}

/**
 * 检查工具调用是否已批准且未过期
 */
export function isToolCallApproved(
  conversationId: string,
  toolName: string,
  input: Record<string, unknown>
): boolean {
  const key = generateApprovalKey(conversationId, toolName, input)
  const approvedAt = approvedToolCalls.get(key)

  if (!approvedAt) return false

  if (Date.now() - approvedAt > APPROVAL_TTL_MS) {
    approvedToolCalls.delete(key)
    console.log('[ApprovalContext] Approval expired:', key)
    return false
  }

  return true
}

/**
 * 清除工具调用的审批标记
 */
export function clearToolCallApproval(
  conversationId: string,
  toolName: string,
  input: Record<string, unknown>
): void {
  const key = generateApprovalKey(conversationId, toolName, input)
  approvedToolCalls.delete(key)
  console.log('[ApprovalContext] Cleared approval:', key)
}

/**
 * 清除指定对话的所有审批状态（pending + approved）
 */
export function clearConversationApprovals(conversationId: string): void {
  clearPendingApproval(conversationId)

  const prefix = `${conversationId}:`
  let count = 0
  for (const key of approvedToolCalls.keys()) {
    if (key.startsWith(prefix)) {
      approvedToolCalls.delete(key)
      count++
    }
  }

  console.log('[ApprovalContext] Cleared conversation approvals:', conversationId, 'count:', count)
}

/**
 * 清除所有审批状态（pending + approved）
 */
export function clearAllApprovals(): void {
  pendingApprovals.clear()
  approvedToolCalls.clear()
  console.log('[ApprovalContext] Cleared all approvals')
}

/**
 * 清理过期的审批记录
 */
function cleanupExpiredApprovals(): void {
  const now = Date.now()
  let count = 0

  for (const [key, approvedAt] of approvedToolCalls.entries()) {
    if (now - approvedAt > APPROVAL_TTL_MS) {
      approvedToolCalls.delete(key)
      count++
    }
  }

  if (count > 0) {
    console.log('[ApprovalContext] Cleaned up expired approvals:', count)
  }
}