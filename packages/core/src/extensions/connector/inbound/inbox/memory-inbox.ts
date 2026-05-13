import type { InboundEvent, InboundInbox, InboundInboxStats, PublishResult, Unsubscribe } from '../types'

interface StoredInboxEvent {
  event: InboundEvent
  queuedAt: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error?: string
}

export class MemoryInboundInbox implements InboundInbox {
  private events: StoredInboxEvent[] = []
  private handlers = new Set<(event: InboundEvent) => Promise<void>>()
  private seenEventKeys = new Set<string>()

  constructor(private readonly maxSize = 100) {}

  async publish(event: InboundEvent): Promise<PublishResult> {
    const eventKey = `${event.connectorId}:${event.protocol}:${event.externalEventId}`
    if (this.seenEventKeys.has(eventKey)) {
      return { eventId: event.id, accepted: false, reason: 'duplicate' }
    }

    if (this.events.length >= this.maxSize) {
      this.events = this.events.filter(item => item.status !== 'completed' && item.status !== 'failed')
      if (this.events.length >= this.maxSize) {
        const oldestPending = this.events.find(item => item.status === 'pending')
        if (!oldestPending) {
          return { eventId: event.id, accepted: false, reason: 'queue_full' }
        }
        this.events = this.events.filter(item => item !== oldestPending)
      }
    }

    this.seenEventKeys.add(eventKey)
    const stored: StoredInboxEvent = {
      event,
      queuedAt: Date.now(),
      status: 'pending',
    }
    this.events.push(stored)
    this.dispatch(stored)

    return { eventId: event.id, accepted: true }
  }

  subscribe(handler: (event: InboundEvent) => Promise<void>): Unsubscribe {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  getStats(): InboundInboxStats {
    return {
      total: this.events.length,
      pending: this.events.filter(item => item.status === 'pending').length,
      processing: this.events.filter(item => item.status === 'processing').length,
      completed: this.events.filter(item => item.status === 'completed').length,
      failed: this.events.filter(item => item.status === 'failed').length,
      dead: 0,
      maxSize: this.maxSize,
    }
  }

  private dispatch(stored: StoredInboxEvent): void {
    stored.status = 'processing'

    Promise.resolve()
      .then(async () => {
        for (const handler of this.handlers) {
          await handler(stored.event)
        }
        stored.status = 'completed'
      })
      .catch((error) => {
        stored.status = 'failed'
        stored.error = error instanceof Error ? error.message : String(error)
        console.error('[MemoryInboundInbox] Processing failed:', stored.event.id, error)
      })
  }
}
