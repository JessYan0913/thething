import type { InboundEvent } from './types'
import type { ConnectorInboundGateway } from './gateway/inbound-gateway'
import type { InboundInbox, Unsubscribe } from './types'
import type { ConnectorResponder } from './responder/responder'

export interface InboundAgentService {
  handle(event: InboundEvent): Promise<void>
}

export class DefaultConnectorInboundRuntime {
  private unsubscribe?: Unsubscribe

  constructor(
    readonly gateway: ConnectorInboundGateway,
    readonly inbox: InboundInbox,
    readonly responder: ConnectorResponder,
  ) {}

  startConsumer(service: InboundAgentService): void {
    this.stopConsumer()
    this.unsubscribe = this.inbox.subscribe((event) => service.handle(event))
  }

  stopConsumer(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = undefined
    }
  }
}
