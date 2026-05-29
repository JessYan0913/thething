// ============================================================
// Connector Inbound Layer - 入站消息处理
// ============================================================

export { parseWechatXml, xmlToInboundEvent, encryptWechatMessage } from './adapters/wechat'
export {
  InboundEventProcessor,
  type InboundEventHandler,
  type InboundEventResult,
} from './inbound-processor'
export * from './types'
export { ConnectorInboundGateway } from './gateway/inbound-gateway'
export type { InboundHttpRequest } from './gateway/http-request'
export type { ProtocolAdapter } from './adapters/protocol-adapter'
export { WechatProtocolAdapter } from './adapters/wechat'
export { FeishuHttpProtocolAdapter, FeishuWsProtocolAdapter } from './adapters/feishu'
export { TestProtocolAdapter } from './adapters/test-adapter'
export { TaskTriggerProtocolAdapter } from './adapters/task-trigger-adapter'
export { RestApiProtocolAdapter } from './adapters/rest-api-adapter'
export { MemoryInboundInbox } from './inbox/memory-inbox'
export { SQLiteInboundInbox } from './inbox/sqlite-inbox'
export { ConnectorResponder } from './responder/responder'
export { DefaultConnectorInboundRuntime } from './runtime'
export { FeishuWsClient } from './feishu-ws-client'
export type { FeishuWsClientConfig } from './feishu-ws-client'
