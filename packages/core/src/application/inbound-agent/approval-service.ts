import type { ReplyAddress } from '../../extensions/connector/inbound/types'

export interface PendingApproval {
  id: string
  conversationId: string
  connectorEventId?: string
  replyAddress: ReplyAddress
  pausedModelMessages: unknown[]
  accumulatedSteps: unknown[]
  responseText: string
  writtenFiles: Array<{ path: string; content: string }>
  approvedTools: string[]
  toolCallId: string
  toolName: string
  toolInput: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'expired'
  createdAt: number
  expiresAt: number
}

