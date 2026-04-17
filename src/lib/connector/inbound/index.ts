// ============================================================
// Connector Inbound Layer - 入站消息处理
// ============================================================

export { WechatMessageCrypto, parseWechatXml, xmlToInboundEvent } from './wechat-crypto'
export { FeishuMessageCrypto, FeishuWebhookHandler } from './feishu-crypto'
export {
  WechatWebhookHandler,
  FeishuWebhookHandlerAdapter,
  createWebhookHandler,
  type WebhookHandlerResult,
  type WebhookConfig,
} from './webhook-handler'
export { inboundEventQueue, type QueuedEvent, type InboundEventQueue } from './event-queue'
export {
  inboundEventProcessor,
  type InboundEventHandler,
  type InboundEventResult,
  type InboundEventProcessor,
} from './inbound-processor'