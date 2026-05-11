// ============================================================
// Connector Gateway 初始化
// ============================================================
//
// 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
// 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。
//
// ⚠️ 此模块已废弃，请使用 factory.ts 中的 createConnectorRuntime
// ============================================================

import path from 'path'
import type { AppContext } from '../../api/app'
import { ConnectorRegistry } from './registry'
import { InboundEventProcessor, InboundEventQueue, createAgentInboundHandler } from './inbound'
import type { AgentHandlerConfig } from './inbound'
import type { ConnectorModelConfig } from './types'
import { IdempotencyGuard, configureIdempotencyGuard, getIdempotencyGuard, getIdempotencyGuardSync } from './idempotency'
import { AuditLogger } from './audit-logger'
import { getProjectConfigDir, getProjectDataDir } from '../../foundation/paths'
import { debugLog, debugWarn } from './debug'

// ============================================================================
// Connector Gateway Configuration
// ============================================================================

export interface ConnectorGatewayConfig {
  /** Project directory for loading connector configs */
  cwd?: string;
  /** Directory containing connector YAML configs. */
  configDir?: string;
  /** Path to idempotency database. Defaults to <dataDir>/connector-idempotency.db */
  idempotencyDbPath?: string;
  userId?: string;
  /** AppContext（启用 Inbound 时必须提供） */
  context?: AppContext;
  /** 是否启用 Inbound 处理（默认 true，设为 false 时只初始化 Registry） */
  enableInbound?: boolean;
  /** 复用已有的 ConnectorRegistry（避免重复创建） */
  registry?: ConnectorRegistry;
  /** Agent 模块配置（用于 Inbound 处理） */
  modules?: {
    /** MCP 工具（默认 true） */
    mcps?: boolean
    /** 技能系统（默认 true） */
    skills?: boolean
    /** 记忆系统（默认 true） */
    memory?: boolean
    /** Connector 工具（默认 false，避免循环调用） */
    connectors?: boolean
  }
  /** 模型配置（用于 Inbound 处理，必须提供） */
  modelConfig?: ConnectorModelConfig
}

// 单例 Registry（按 cwd 缓存）
const connectorRegistries = new Map<string, ConnectorRegistry>()
let inboundInitialized = false
// 临时：保持向后兼容的单例实例
let inboundEventQueueInstance: InboundEventQueue | null = null
let inboundEventProcessorInstance: InboundEventProcessor | null = null
let auditLoggerInstance: AuditLogger | null = null
let idempotencyGuardInstance: IdempotencyGuard | null = null

/**
 * 获取 Connector Registry 单例
 *
 * @param cwd 项目目录，用于加载 connector 配置
 *
 * 注意：configDirName 从全局单例 getResolvedConfigDirName() 获取
 */
export async function getConnectorRegistry(cwd?: string): Promise<ConnectorRegistry> {
  const effectiveCwd = cwd ?? process.cwd()

  if (!connectorRegistries.has(effectiveCwd)) {
    const configDir = getProjectConfigDir(effectiveCwd, 'connectors')
    const registry = new ConnectorRegistry(configDir)
    await registry.initialize()
    connectorRegistries.set(effectiveCwd, registry)
    debugLog('[ConnectorGateway] Initialized registry with', registry.getConnectorIds().length, 'connectors')
  }

  return connectorRegistries.get(effectiveCwd)!
}

/**
 * 初始化 Connector Gateway
 * 包括 Registry 和 Inbound Processor
 *
 * 重要：此函数必须在 bootstrap() 之后调用，以确保：
 * 1. configDirName/dataDir 已正确设置
 * 2. IdempotencyGuard 使用正确的数据库路径
 */
export async function initConnectorGateway(config?: ConnectorGatewayConfig): Promise<void> {
  const cwd = config?.cwd ?? process.cwd()

  // ============================================================
  // Step 1: 配置 IdempotencyGuard（必须在任何使用前）
  // ============================================================
  const dataDir = getProjectDataDir(cwd)
  const idempotencyDbPath = config?.idempotencyDbPath ?? path.join(dataDir, 'connector-idempotency.db')

  try {
    configureIdempotencyGuard({ dbPath: idempotencyDbPath })
    debugLog('[ConnectorGateway] IdempotencyGuard configured with path:', idempotencyDbPath)
  } catch (err) {
    // 如果已初始化，警告但继续
    debugWarn('[ConnectorGateway] IdempotencyGuard already configured:', err instanceof Error ? err.message : String(err))
  }

  // 预初始化 IdempotencyGuard（确保数据库创建在正确路径）
  await getIdempotencyGuard()

  // ============================================================
  // Step 2: 初始化 Registry
  // ============================================================
  const registry = config?.registry ?? await getConnectorRegistry(cwd)

  debugLog('[ConnectorGateway] Initialized registry with', registry.getConnectorIds().length, 'connectors')

  // ============================================================
  // Step 3: 初始化 Inbound Processor（可选）
  // ============================================================
  if (config?.enableInbound !== false) {
    if (!config?.context) {
      debugWarn('[ConnectorGateway] context is required for Inbound processor. Skipping inbound initialization.')
      return
    }
    if (!config?.modelConfig) {
      debugWarn('[ConnectorGateway] modelConfig is required for Inbound processor. Skipping inbound initialization.')
      return
    }

    // 创建实例（临时向后兼容）
    if (!inboundEventQueueInstance) {
      inboundEventQueueInstance = new InboundEventQueue()
    }
    if (!auditLoggerInstance) {
      auditLoggerInstance = new AuditLogger()
    }
    if (!inboundEventProcessorInstance) {
      inboundEventProcessorInstance = new InboundEventProcessor()
      inboundEventProcessorInstance.setQueue(inboundEventQueueInstance)
      inboundEventProcessorInstance.setAuditLogger(auditLoggerInstance)
    }

    const handlerConfig: AgentHandlerConfig = {
      registry,
      userId: config?.userId,
      context: config.context,
      modules: config?.modules,
      modelConfig: config.modelConfig,
    }

    const handler = createAgentInboundHandler(handlerConfig)
    inboundEventProcessorInstance.setHandler(handler)
    inboundEventProcessorInstance.setRegistry(registry)
    inboundEventProcessorInstance.start()

    inboundInitialized = true
    debugLog('[ConnectorGateway] Inbound processor started')
  }
}

/**
 * 检查 Inbound 是否已初始化
 */
export function isInboundInitialized(): boolean {
  return inboundInitialized
}

/**
 * 获取 InboundEventQueue 实例（向后兼容）
 */
export function getInboundEventQueue(): InboundEventQueue | null {
  return inboundEventQueueInstance
}

/**
 * 关闭 Connector Gateway（清理资源）
 */
export async function shutdownConnectorGateway(): Promise<void> {
  for (const [key, registry] of connectorRegistries) {
    registry.dispose()
    connectorRegistries.delete(key)
  }
  if (inboundEventProcessorInstance) {
    inboundEventProcessorInstance.stop()
    inboundEventProcessorInstance = null
  }
  inboundEventQueueInstance = null
  auditLoggerInstance = null
  inboundInitialized = false
  debugLog('[ConnectorGateway] Shutdown complete')
}

// Re-export IdempotencyGuard functions
export { getIdempotencyGuard, getIdempotencyGuardSync, configureIdempotencyGuard } from './idempotency'