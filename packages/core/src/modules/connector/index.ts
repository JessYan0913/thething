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

// Inbound Layer - 入站消息处理（通信基础设施）
export * from './inbound/index'

// Runtime Factory
export {
  createConnectorRuntime,
  initializeConnectorRuntime,
  disposeConnectorRuntime,
} from './factory'

// Connector Loader（YAML 加载）
export {
  loadConnectorYaml,
  scanConnectorDirs,
  getAvailableConnectors,
  ConnectorFrontmatterSchema,
  type ConnectorFrontmatter,
  type ConnectorLoaderConfig,
} from './loader'
