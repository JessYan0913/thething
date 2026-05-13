import type { InboundEvent } from '../../extensions/connector/inbound/types'
import type { InboundEventHandler } from '../../extensions/connector/inbound/inbound-processor'

export interface InboundAgentService {
  handle(event: InboundEvent): Promise<void>
}

export class DefaultInboundAgentService implements InboundAgentService {
  constructor(private readonly handler: InboundEventHandler) {}

  async handle(event: InboundEvent): Promise<void> {
    await this.handler.handle(event)
  }
}
