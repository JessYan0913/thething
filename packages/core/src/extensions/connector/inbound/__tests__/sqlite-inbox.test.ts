import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { SQLiteInboundInbox } from '../inbox/sqlite-inbox'
import type { InboundEvent } from '../types'

describe('SQLiteInboundInbox', () => {
  it('deduplicates by connector, protocol and external event id', async () => {
    const inbox = new SQLiteInboundInbox({
      dbPath: tempDbPath(),
      pollIntervalMs: 10_000,
    })

    try {
      const event = inboundEvent('event-1', 'external-1')
      const first = await inbox.publish(event)
      const duplicate = await inbox.publish({
        ...event,
        id: 'event-2',
      })

      expect(first.accepted).toBe(true)
      expect(duplicate.accepted).toBe(false)
      expect(duplicate.reason).toBe('duplicate')
    } finally {
      inbox.close()
    }
  })

  it('retries failures and moves exhausted events to dead-letter', async () => {
    const inbox = new SQLiteInboundInbox({
      dbPath: tempDbPath(),
      maxAttempts: 2,
      retryBaseDelayMs: 1,
      pollIntervalMs: 10,
    })

    let attempts = 0
    inbox.subscribe(async () => {
      attempts += 1
      throw new Error('boom')
    })

    try {
      await inbox.publish(inboundEvent('event-1', 'external-1'))
      await waitFor(() => inbox.getStats().dead === 1)

      expect(attempts).toBe(2)
      expect(inbox.getStats()).toMatchObject({
        dead: 1,
        pending: 0,
        processing: 0,
      })
    } finally {
      inbox.close()
    }
  })

  it('renews processing locks while a handler is still running', async () => {
    const inbox = new SQLiteInboundInbox({
      dbPath: tempDbPath(),
      visibilityTimeoutMs: 50,
      heartbeatIntervalMs: 10,
      pollIntervalMs: 10,
    })

    let attempts = 0
    let active = 0
    let maxConcurrent = 0
    inbox.subscribe(async () => {
      attempts += 1
      active += 1
      maxConcurrent = Math.max(maxConcurrent, active)
      try {
        await new Promise(resolve => setTimeout(resolve, 160))
      } finally {
        active -= 1
      }
    })

    try {
      await inbox.publish(inboundEvent('event-1', 'external-1'))
      await waitFor(() => inbox.getStats().completed === 1)

      expect(attempts).toBe(1)
      expect(maxConcurrent).toBe(1)
      expect(inbox.getStats()).toMatchObject({
        completed: 1,
        processing: 0,
        pending: 0,
      })
    } finally {
      inbox.close()
    }
  })
})

function tempDbPath(): string {
  return path.join(os.tmpdir(), `thething-inbox-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

function inboundEvent(id: string, externalEventId: string): InboundEvent {
  return {
    id,
    connectorId: 'test-service',
    protocol: 'test-service',
    transport: 'test',
    externalEventId,
    channel: { id: 'channel-1' },
    sender: { id: 'user-1', type: 'user' },
    message: { id: externalEventId, type: 'text', text: 'hello' },
    replyAddress: {
      connectorId: 'test-service',
      protocol: 'test-service',
      channelId: 'channel-1',
      messageId: externalEventId,
    },
    receivedAt: Date.now(),
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition')
}
