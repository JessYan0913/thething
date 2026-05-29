// ============================================================
// Connector Gateway 导出入口
// ============================================================

export * from './types'
export { ConnectorRegistry } from './registry'
export { AuditLogger } from './audit-logger'
export { ConnectorToolExecutor } from './executor'
export { MockExecutor } from './executors/mock'
export {
  convertConnectorToolToAItool,
  getAllConnectorTools,
  buildZodSchemaFromToolDefinition,
  schemaPropertyToZod,
} from './tool-adapter'

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
