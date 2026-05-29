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
import { AuditLogger } from './audit-logger'
import { InboundEventProcessor } from './inbound/inbound-processor'
import { ConnectorInboundGateway } from './inbound/gateway/inbound-gateway'
import { SQLiteInboundInbox } from './inbound/inbox/sqlite-inbox'
import { MemoryInboundInbox } from './inbound/inbox/memory-inbox'
import { ConnectorResponder } from './inbound/responder/responder'
import { DefaultConnectorInboundRuntime } from './inbound/runtime'

export interface InitializeConnectorRuntimeOptions {
  startConsumer?: boolean
}

/**
 * 创建 ConnectorRuntime 实例
 *
 * @param config 配置参数（所有路径显式传入）
 * @returns ConnectorRuntime 实例
 */
export function createConnectorRuntime(config: ConnectorRuntimeConfig): ConnectorRuntime {
  // 1. 创建 Registry
  const registry = new ConnectorRegistry(config.configDir, {
    env: config.env,
    allowUnsafeScriptExecutor: config.allowUnsafeScriptExecutor,
  })

  // 2. 创建 AuditLogger（可选持久化到 SQLite）
  const auditLogger = new AuditLogger({
    dbPath: path.join(config.dataDir, 'connector-audit.db'),
    enablePersistence: true,
  })

  // 3. 创建 EventProcessor
  const eventProcessor = new InboundEventProcessor()

  // 4. 创建 Inbox（根据配置选择 SQLite 或 Memory）
  const inbox = config.useMemoryInbox
    ? new MemoryInboundInbox()
    : SQLiteInboundInbox.fromDataDir(config.dataDir)

  // 5. 创建 Responder、Gateway、Inbound
  const responder = new ConnectorResponder({ registry })
  const gateway = new ConnectorInboundGateway({ registry, inbox })
  const inbound = new DefaultConnectorInboundRuntime(gateway, inbox, responder)

  return {
    registry,
    auditLogger,
    inbound,
    inboundService: eventProcessor,
  }
}

/**
 * 初始化 ConnectorRuntime
 *
 * 加载 connector 配置并启动事件处理。
 *
 * @param runtime ConnectorRuntime 实例
 */
export async function initializeConnectorRuntime(
  runtime: ConnectorRuntime,
  options?: InitializeConnectorRuntimeOptions,
): Promise<void> {
  // 1. 初始化 Registry（加载 YAML 配置）
  await runtime.registry.initialize()

  // 2. 启动标准入站消费者
  if (options?.startConsumer !== false) {
    runtime.inbound.startConsumer(runtime.inboundService)
  }
}

/**
 * 释放 ConnectorRuntime 资源
 *
 * @param runtime ConnectorRuntime 实例
 */
export async function disposeConnectorRuntime(runtime: ConnectorRuntime): Promise<void> {
  // 1. 释放 Registry 资源
  runtime.registry.dispose()

  // 2. 停止并关闭入站运行时
  runtime.inbound.stopConsumer()
  const inbox = runtime.inbound.inbox as { close?: () => void }
  inbox.close?.()
}
