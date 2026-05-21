// ============================================================
// Connector Runtime Factory - 创建和管理 ConnectorRuntime 实例
// ============================================================
//
// 设计原则：
// - 纯工厂函数，不使用进程级单例
// - 所有配置显式传入，不读取 process.env
// - 由应用层管理实例生命周期

import type { ConnectorRuntime, ConnectorRuntimeConfig } from './types'
import { ConnectorRegistry } from './registry'
import { InboundEventProcessor } from './inbound/inbound-processor'
import { ConnectorInboundGateway } from './inbound/gateway/inbound-gateway'
import { MemoryInboundInbox } from './inbound/inbox/memory-inbox'
import { ConnectorResponder } from './inbound/responder/responder'
import { DefaultConnectorInboundRuntime } from './inbound/runtime'
export function createConnectorRuntime(config: ConnectorRuntimeConfig): ConnectorRuntime {
  const registry = new ConnectorRegistry(config.configDir, {
    env: config.env,
  })

  const eventProcessor = new InboundEventProcessor()

  const responder = new ConnectorResponder({ registry })
  const inbox = new MemoryInboundInbox()
  const gateway = new ConnectorInboundGateway({ registry, inbox })
  const inbound = new DefaultConnectorInboundRuntime(gateway, inbox, responder)

  return {
    registry,
    inbound,
    inboundService: eventProcessor,
  }
}

export async function initializeConnectorRuntime(
  runtime: ConnectorRuntime,
  options?: { startConsumer?: boolean },
): Promise<void> {
  await runtime.registry.initialize()

  if (options?.startConsumer !== false) {
    runtime.inbound.startConsumer(runtime.inboundService)
  }
}

export async function disposeConnectorRuntime(runtime: ConnectorRuntime): Promise<void> {
  runtime.registry.dispose()
  runtime.inbound.stopConsumer()
}
