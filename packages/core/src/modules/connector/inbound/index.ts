// ============================================================
// Connector Inbound Layer - 入站消息处理
// ============================================================

export { WechatMessageCrypto, parseWechatXml, xmlToInboundEvent } from './crypto/wechat-crypto'
export { FeishuMessageCrypto } from './crypto/feishu-crypto'
export {
  InboundEventProcessor,
  type InboundEventHandler,
  type InboundEventResult,
} from './inbound-processor'
export * from './types'
export { ConnectorInboundGateway } from './gateway/inbound-gateway'
export type { InboundHttpRequest } from './gateway/http-request'
export type { ProtocolAdapter } from './adapters/protocol-adapter'
export { WechatProtocolAdapter } from './adapters/wechat-adapter'
export { FeishuHttpProtocolAdapter } from './adapters/feishu-http-adapter'
export { FeishuWsProtocolAdapter } from './adapters/feishu-ws-adapter'
export { TestProtocolAdapter } from './adapters/test-adapter'
export { MemoryInboundInbox } from './inbox/memory-inbox'
export { SQLiteInboundInbox } from './inbox/sqlite-inbox'
export { ConnectorResponder } from './responder/responder'
export { DefaultConnectorInboundRuntime } from './runtime'

// Agent 入站处理器
export { AgentInboundHandler, createAgentInboundHandler } from './agent-handler'
export type { AgentHandlerConfig } from './agent-handler'
