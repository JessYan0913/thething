import type { InboundEvent } from '../../modules/connector/inbound/types'
import type { InboundEventHandler } from '../../modules/connector/inbound/inbound-processor'
import type { InboundAgentService } from '../../modules/connector/inbound/runtime'

export { type InboundAgentService } from '../../modules/connector/inbound/runtime'

export class DefaultInboundAgentService implements InboundAgentService {
  constructor(private readonly handler: InboundEventHandler) {}

  async handle(event: InboundEvent): Promise<void> {
    await this.handler.handle(event)
  }
}
