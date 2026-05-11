// ============================================================
// Connector Runtime Factory - 创建和管理 ConnectorRuntime 实例
// ============================================================
//
// 设计原则：
// - 纯工厂函数，不使用进程级单例
// - 所有配置显式传入，不读取 process.env
// - 由应用层管理实例生命周期

import path from 'path'
import type { ConnectorRuntime, ConnectorRuntimeConfig } from './types'
import { ConnectorRegistry } from './registry'
import { IdempotencyGuard } from './idempotency'
import { AuditLogger } from './audit-logger'
import { InboundEventQueue } from './inbound/event-queue'
import { InboundEventProcessor } from './inbound/inbound-processor'
import { createAgentInboundHandler, type AgentHandlerConfig } from './inbound/agent-handler'
import type { AppContext } from '../../api/app'

/**
 * 创建 ConnectorRuntime 实例
 *
 * @param config 配置参数（所有路径显式传入）
 * @returns ConnectorRuntime 实例
 */
export function createConnectorRuntime(config: ConnectorRuntimeConfig): ConnectorRuntime {
  // 1. 创建 Registry（不按 cwd 缓存，每次创建新实例）
  const registry = new ConnectorRegistry(config.configDir)

  // 2. 创建 IdempotencyGuard（显式传入路径）
  const idempotencyGuard = new IdempotencyGuard({
    dbPath: path.join(config.dataDir, 'connector-idempotency.db'),
  })

  // 3. 创建 AuditLogger（可选持久化到 SQLite）
  const auditLogger = new AuditLogger({
    dbPath: path.join(config.dataDir, 'connector-audit.db'),
    enablePersistence: true,
  })

  // 4. 创建 EventQueue
  const eventQueue = new InboundEventQueue()

  // 5. 创建 EventProcessor
  const eventProcessor = new InboundEventProcessor()

  // 6. 配置 EventProcessor 与 Queue 的关联
  eventProcessor.setQueue(eventQueue)
  eventProcessor.setAuditLogger(auditLogger)

  // 7. 如果有 AppContext，配置 inbound handler
  if (config.appContext) {
    const handlerConfig: AgentHandlerConfig = {
      registry,
      userId: config.userId,
      context: config.appContext as AppContext,
      // 如果提供了模型配置，注入到 handler
      modelConfig: config.model,
    }
    const handler = createAgentInboundHandler(handlerConfig)
    eventProcessor.setHandler(handler)
    eventProcessor.setRegistry(registry)
  }

  return {
    registry,
    idempotencyGuard,
    auditLogger,
    eventQueue,
    eventProcessor,
  }
}

/**
 * 初始化 ConnectorRuntime
 *
 * 加载 connector 配置并启动事件处理。
 *
 * @param runtime ConnectorRuntime 实例
 */
export async function initializeConnectorRuntime(runtime: ConnectorRuntime): Promise<void> {
  // 1. 初始化 Registry（加载 YAML 配置）
  await runtime.registry.initialize()

  // 2. 启动 EventProcessor（注册队列回调）
  runtime.eventProcessor.start()
}

/**
 * 释放 ConnectorRuntime 资源
 *
 * @param runtime ConnectorRuntime 实例
 */
export async function disposeConnectorRuntime(runtime: ConnectorRuntime): Promise<void> {
  // 1. 停止 EventProcessor
  runtime.eventProcessor.stop()

  // 2. 释放 Registry 资源
  runtime.registry.dispose()

  // 3. 关闭 IdempotencyGuard 数据库
  runtime.idempotencyGuard.close()
}