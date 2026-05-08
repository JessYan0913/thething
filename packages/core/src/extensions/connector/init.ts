// ============================================================
// Connector Gateway 初始化
// ============================================================
//
// 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
// 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。

import type { AppContext } from '../../api/app'
import { ConnectorRegistry } from './registry'
import { inboundEventProcessor, createAgentInboundHandler } from './inbound'
import type { AgentHandlerConfig } from './inbound'
import { configureIdempotencyGuard, getIdempotencyGuard } from './idempotency'
import { getProjectConfigDir } from '../../foundation/paths'
import { debugLog, debugWarn } from './debug'

// ============================================================================
// Connector Gateway Configuration
// ============================================================================

export interface ConnectorGatewayConfig {
  /** Project directory for loading connector configs */
  cwd?: string;
  /** Directory containing connector YAML configs. */
  configDir?: string;
  /** Path to idempotency database. Defaults to <cwd>/<configDirName>/data/.connector-idempotency.db */
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
}

// 单例 Registry（按 cwd 缓存）
const connectorRegistries = new Map<string, ConnectorRegistry>()
let inboundInitialized = false

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
 */
export async function initConnectorGateway(config?: ConnectorGatewayConfig): Promise<void> {
  // 配置 IdempotencyGuard（可选路径）
  if (config?.idempotencyDbPath) {
    configureIdempotencyGuard({ dbPath: config.idempotencyDbPath })
  }

  // 优先使用传入的 registry，否则创建新的
  const registry = config?.registry ?? await getConnectorRegistry(config?.cwd)

  debugLog('[ConnectorGateway] Initialized registry with', registry.getConnectorIds().length, 'connectors')

  // 初始化 Inbound Processor（可选）
  if (config?.enableInbound !== false) {
    if (!config?.context) {
      debugWarn('[ConnectorGateway] context is required for Inbound processor. Skipping inbound initialization.')
      return
    }
    const handlerConfig: AgentHandlerConfig = {
      registry,
      userId: config?.userId,
      context: config.context,
      modules: config?.modules,
    }

    const handler = createAgentInboundHandler(handlerConfig)
    inboundEventProcessor.setHandler(handler)
    inboundEventProcessor.setRegistry(registry)
    inboundEventProcessor.start()

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
 * 关闭 Connector Gateway（清理资源）
 */
export async function shutdownConnectorGateway(): Promise<void> {
  for (const [key, registry] of connectorRegistries) {
    registry.dispose()
    connectorRegistries.delete(key)
  }
  inboundInitialized = false
  debugLog('[ConnectorGateway] Shutdown complete')
}

// Re-export getIdempotencyGuard for convenience
export { getIdempotencyGuard } from './idempotency'