import type { InboundEvent } from '../../extensions/connector/inbound/types'

export interface ConversationResolver {
  resolve(event: InboundEvent): Promise<string>
}

export class DefaultConversationResolver implements ConversationResolver {
  async resolve(event: InboundEvent): Promise<string> {
    return `connector:${event.connectorId}:channel:${event.channel.id}`
  }
}

