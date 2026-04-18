// ============================================================
// Connector Gateway 导出入口
// ============================================================

export * from './types'
export { ConnectorRegistry } from './registry'
export { TokenManager } from './token-manager'
export { AuthManager, authManager } from './auth/manager'
export { HttpExecutor } from './executors/http'
export { MockExecutor } from './executors/mock'
export { SqlExecutor } from './executors/sql'
export { MultiSqlExecutor } from './executors/multi-sql'
export { DatabasePoolManager, databasePoolManager } from './executors/database-pool'
export {
  convertConnectorToolToAItool,
  getAllConnectorTools,
  buildZodSchemaFromToolDefinition,
  schemaPropertyToZod,
} from './tool-adapter'
export { withRetry } from './retry'
export { CircuitBreaker, CircuitBreakerRegistry, CircuitBreakerError } from './circuit-breaker'
export { AuditLogger, auditLogger } from './audit-logger'
export { IdempotencyGuard, idempotencyGuard } from './idempotency'

// 凭证加密存储
export * from './credentials/index'

// Inbound Layer - 入站消息处理
export * from './inbound/index'

// 初始化函数
export {
  getConnectorRegistry,
  initConnectorGateway,
  isInboundInitialized,
  shutdownConnectorGateway,
} from './init'

// Webhook 配置动态加载（通用）
export {
  loadWebhookConfigs,
  getWebhookConfig,
  getWebhookConfigByHandler,
  getWebhookConfigByPath,
  buildWechatWebhookConfig,
  buildFeishuWebhookConfig,
  buildGenericWebhookConfig,
  refreshWebhookConfigs,
  getWebhookConnectorsInfo,
  type WebhookConfigLoaded,
  type WechatWebhookConfig,
  type FeishuWebhookConfig,
} from './webhook-config'
