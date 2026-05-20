// ============================================================
// Composition Inbound Layer — Agent 入站编排
// ============================================================

// 从原 composition/inbound-agent/ 来的
export { DefaultConversationResolver, type ConversationResolver } from './conversation-resolver'
export { DefaultInboundAgentService, type InboundAgentService } from './inbound-agent-service'
export type { AgentRunner } from './agent-runner'
export type { PendingApproval } from './approval-service'
export type { InboundPostProcess } from './post-process'

// Agent 入站处理器（从 connector 搬来的）
export { AgentInboundHandler, createAgentInboundHandler, type AgentHandlerConfig } from './agent-handler'

// 入站运行时配置（从 connector/factory 拆出的）
export { configureConnectorInboundRuntime, type ConfigureConnectorInboundOptions } from './configure'

// 审批逻辑（从 connector 搬来的）
export {
  buildApprovalAskMessage,
  parseApprovalResponse,
  buildApprovalAskMessageForRequests,
} from './approval-handler'
export type { SuspendedAgentState } from './approval-context'
export {
  getSuspendedState,
  setSuspendedState,
  clearSuspendedState,
  hasSuspendedState,
  detectApprovalResponse,
  clearAllSuspendedStates,
  cleanupExpiredSuspendedStates,
} from './approval-context'
