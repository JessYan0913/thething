// ============================================================
// Connector Gateway 初始化
// ============================================================

import path from 'path'
import { ConnectorRegistry } from './registry'
import { inboundEventProcessor, createAgentInboundHandler } from './inbound'
import type { AgentHandlerConfig } from './inbound'

// ============================================================================
// Connector Gateway Configuration
// ============================================================================

export interface ConnectorGatewayConfig {
  /** Directory containing connector YAML configs. Defaults to process.cwd() + '/connectors' */
  configDir?: string;
  userId?: string;
  model?: string;
  enableInbound?: boolean;
}

const DEFAULT_CONFIG_DIR = path.join(process.cwd(), 'connectors')

let configuredConfigDir: string = DEFAULT_CONFIG_DIR

// 单例 Registry
let connectorRegistry: ConnectorRegistry | null = null
let inboundInitialized = false

/**
 * Configure the connector config directory before calling getConnectorRegistry().
 * Must be called before first getConnectorRegistry() invocation.
 */
export function configureConnectorGateway(config: ConnectorGatewayConfig): void {
  if (connectorRegistry) {
    console.warn('[ConnectorGateway] Registry already initialized. configureConnectorGateway() must be called before first getConnectorRegistry().')
    return
  }
  configuredConfigDir = config.configDir || DEFAULT_CONFIG_DIR
}

/**
 * 获取 Connector Registry 单例
 */
export async function getConnectorRegistry(): Promise<ConnectorRegistry> {
  if (!connectorRegistry) {
    connectorRegistry = new ConnectorRegistry(configuredConfigDir)
    await connectorRegistry.initialize()
  }
  return connectorRegistry
}

/**
 * 初始化 Connector Gateway
 * 包括 Registry 和 Inbound Processor
 */
export async function initConnectorGateway(config?: ConnectorGatewayConfig): Promise<void> {
  // Apply config dir if provided and not yet initialized
  if (config?.configDir && !connectorRegistry) {
    configuredConfigDir = config.configDir
  }

  const registry = await getConnectorRegistry()

  console.log('[ConnectorGateway] Initialized registry with', registry.getConnectorIds().length, 'connectors')

  // 初始化 Inbound Processor（可选）
  if (config?.enableInbound !== false) {
    const handlerConfig: AgentHandlerConfig = {
      registry,
      userId: config?.userId,
      model: config?.model,
    }

    const handler = createAgentInboundHandler(handlerConfig)
    inboundEventProcessor.setHandler(handler)
    inboundEventProcessor.setRegistry(registry)
    inboundEventProcessor.start()

    inboundInitialized = true
    console.log('[ConnectorGateway] Inbound processor started')
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
  if (connectorRegistry) {
    connectorRegistry.dispose()
    connectorRegistry = null
  }
  inboundInitialized = false
  console.log('[ConnectorGateway] Shutdown complete')
}