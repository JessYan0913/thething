import type { UIMessage } from 'ai'

export interface ApprovalRequest {
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
}

export interface ApprovalResponse {
  approvalId: string
  approved: boolean
  reason?: string
}

export interface SelectOption<T = string> {
  label: string
  value: T
}

export interface ToolCallState {
  toolCallId: string
  toolName: string
  summary: string
  input?: unknown
  output?: unknown
  status: 'queued' | 'running' | 'success' | 'error'
  startTime: number
  endTime?: number
  errorText?: string
}

export interface StreamState {
  phase: 'idle' | 'streaming' | 'awaiting-approval' | 'done' | 'error'
  text: string
  reasoning: string
  isReasoning: boolean
  reasoningStartTime: number
  toolCalls: Map<string, ToolCallState>
  approvalRequests: ApprovalRequest[]
  finishedMessages: UIMessage[]
  cost?: { totalCostUsd: number; inputTokens: number; outputTokens: number }
  error?: string
}

export interface CompletedMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  toolCalls?: ToolCallState[]
  reasoning?: string
  cost?: StreamState['cost']
}

export interface CommandResult {
  type: 'handled' | 'exit' | 'unknown'
  output?: string
}

export interface QuestionItem {
  question: string
  header: string
  options: Array<{ label: string; description?: string } | string>
  multiSelect?: boolean
}
