// ============================================================
// Connector Gateway 初始化
// ============================================================
//
// 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
// 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。

import type { LanguageModelV3 } from '@ai-sdk/provider'
import { ConnectorRegistry } from './registry'
import { inboundEventProcessor, createAgentInboundHandler } from './inbound'
import type { AgentHandlerConfig } from './inbound'
import { configureIdempotencyGuard, getIdempotencyGuard } from './idempotency'
import { getProjectConfigDir } from '../../foundation/paths'
import { debugLog, debugWarn } from './debug'
import type { DataStore } from '../../foundation/datastore/types'

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
  /** 模型实例（必须提供，用于 Inbound Processor） */
  model?: LanguageModelV3;
  enableInbound?: boolean;
  /** 数据存储实例（必须提供，用于 Inbound Processor） */
  dataStore?: DataStore;
  /** 复用已有的 ConnectorRegistry（避免重复创建） */
  registry?: ConnectorRegistry;
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
    // 使用全局 configDirName
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
    if (!config?.model || !config?.dataStore) {
      debugWarn('[ConnectorGateway] Model and dataStore are required for Inbound processor. Skipping inbound initialization.')
      return
    }
    const handlerConfig: AgentHandlerConfig = {
      registry,
      userId: config?.userId,
      model: config.model,
      dataStore: config.dataStore,
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