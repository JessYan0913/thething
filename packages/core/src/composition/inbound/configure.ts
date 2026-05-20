// ============================================================
// 入站 Agent 运行时配置 — 绑定 Agent 处理器到 Connector 入站管道
// ============================================================

import type { ConnectorRuntime, ConnectorRuntimeConfig } from '../../modules/connector/types'
import { createAgent } from '../app'
import { DefaultConversationResolver } from './conversation-resolver'
import { createAgentInboundHandler, type AgentHandlerConfig } from './agent-handler'
import { InboundEventProcessor } from '../../modules/connector/inbound/inbound-processor'

type ConnectorAppContext = AgentHandlerConfig['context']

export interface ConfigureConnectorInboundOptions {
  userId?: string
  appContext: ConnectorAppContext
  modules?: AgentHandlerConfig['modules']
  modelConfig?: ConnectorRuntimeConfig['model']
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
    conversationResolver: new DefaultConversationResolver(),
    createAgent,
  }
  const handler = createAgentInboundHandler(handlerConfig)
  const processor = runtime.inboundService as InboundEventProcessor
  processor.setHandler(handler)
  processor.setRegistry(runtime.registry)
  runtime.inbound.startConsumer(processor)
}
