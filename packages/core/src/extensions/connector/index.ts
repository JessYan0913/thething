// ============================================================
// Connector Gateway 导出入口
// ============================================================

export * from './types'
export { ConnectorRegistry } from './registry'
export { TokenManager } from './token-manager'
export { AuthManager } from './auth/manager'
export { HttpExecutor } from './executors/http'
export { MockExecutor } from './executors/mock'
export { SqlExecutor } from './executors/sql'
export { MultiSqlExecutor } from './executors/multi-sql'
export { DatabasePoolManager } from './executors/database-pool'
export {
  convertConnectorToolToAItool,
  getAllConnectorTools,
  buildZodSchemaFromToolDefinition,
  schemaPropertyToZod,
} from './tool-adapter'
export { withRetry } from './retry'
export { CircuitBreaker, CircuitBreakerRegistry, CircuitBreakerError } from './circuit-breaker'
export { AuditLogger } from './audit-logger'

// 凭证加密存储
export * from './credentials/index'

// Approval handling
export {
  buildApprovalAskMessage,
  parseApprovalResponse,
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

// Inbound Layer - 入站消息处理
export * from './inbound/index'

// Runtime Factory
export {
  createConnectorRuntime,
  initializeConnectorRuntime,
  configureConnectorInboundRuntime,
  disposeConnectorRuntime,
} from './factory'
export type { ConfigureConnectorInboundOptions } from './factory'

// Connector Loader（YAML 加载）
export {
  loadConnectorYaml,
  scanConnectorDirs,
  clearConnectorCache,
  getAvailableConnectors,
  ConnectorFrontmatterSchema,
  type ConnectorFrontmatter,
  type ConnectorLoaderConfig,
} from './loader'
