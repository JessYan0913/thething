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
import { createAgentInboundHandler, type AgentHandlerConfig } from './inbound/agent-handler'
import { ConnectorInboundGateway } from './inbound/gateway/inbound-gateway'
import { SQLiteInboundInbox } from './inbound/inbox/sqlite-inbox'
import { ConnectorResponder } from './inbound/responder/responder'
import { DefaultConnectorInboundRuntime } from './inbound/runtime'
import type { AppContext } from '../../api/app'
import { setConnectorDebugEnabled } from './debug'

export interface ConfigureConnectorInboundOptions {
  userId?: string
  appContext: AppContext
  modules?: AgentHandlerConfig['modules']
  modelConfig?: ConnectorRuntimeConfig['model']
}

/**
 * 创建 ConnectorRuntime 实例
 *
 * @param config 配置参数（所有路径显式传入）
 * @returns ConnectorRuntime 实例
 */
export function createConnectorRuntime(config: ConnectorRuntimeConfig): ConnectorRuntime {
  setConnectorDebugEnabled(Boolean(config.debugEnabled))

  // 1. 创建 Registry（不按 cwd 缓存，每次创建新实例）
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

  // 4. 配置 EventProcessor
  eventProcessor.setAuditLogger(auditLogger)

  const responder = new ConnectorResponder({ registry })
  const inbox = SQLiteInboundInbox.fromDataDir(config.dataDir)
  const gateway = new ConnectorInboundGateway({
    registry,
    inbox,
  })
  const inbound = new DefaultConnectorInboundRuntime(gateway, inbox, responder)
  const runtime: ConnectorRuntime = {
    registry,
    auditLogger,
    inbound,
    inboundService: eventProcessor,
  }

  // 5. 如果有 AppContext，配置 inbound handler
  if (config.appContext) {
    configureConnectorInboundRuntime(runtime, {
      userId: config.userId,
      appContext: config.appContext as AppContext,
      modelConfig: config.model,
    })
  }

  return runtime
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
  options?: { startConsumer?: boolean },
): Promise<void> {
  // 1. 初始化 Registry（加载 YAML 配置）
  await runtime.registry.initialize()

  // 2. 启动标准入站消费者
  if (options?.startConsumer !== false) {
    runtime.inbound.startConsumer(runtime.inboundService)
  }
}

/**
 * 绑定入站 Agent 处理器并启动消费者。
 *
 * bootstrap 阶段只能初始化 registry；server 创建 AppContext 和模型配置后，
 * 再调用该函数把标准 InboundEvent 交给 Agent 应用服务。
 */
export function configureConnectorInboundRuntime(
  runtime: ConnectorRuntime,
  options: ConfigureConnectorInboundOptions,
): void {
  const handlerConfig: AgentHandlerConfig = {
    registry: runtime.registry,
    userId: options.userId,
    context: options.appContext,
    modules: options.modules,
    modelConfig: options.modelConfig,
  }
  const handler = createAgentInboundHandler(handlerConfig)
  const processor = runtime.inboundService as InboundEventProcessor
  processor.setHandler(handler)
  processor.setRegistry(runtime.registry)
  runtime.inbound.startConsumer(processor)
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
