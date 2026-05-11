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
export { IdempotencyGuard } from './idempotency'

// 凭证加密存储
export * from './credentials/index'

// Inbound Layer - 入站消息处理
export * from './inbound/index'

// Runtime Factory
export {
  createConnectorRuntime,
  initializeConnectorRuntime,
  disposeConnectorRuntime,
} from './factory'

// 初始化函数（兼容旧代码，后续移除）
export {
  getConnectorRegistry,
  initConnectorGateway,
  isInboundInitialized,
  shutdownConnectorGateway,
  getIdempotencyGuard,
  getInboundEventQueue,
  type ConnectorGatewayConfig,
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