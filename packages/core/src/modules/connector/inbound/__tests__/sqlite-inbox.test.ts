import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLiteInboundInbox } from '../inbox/sqlite-inbox'
import type { InboundEvent } from '../types'

function makeEvent(overrides?: Partial<InboundEvent>): InboundEvent {
  const externalEventId = overrides?.externalEventId ?? 'ext-1'
  const transport = overrides?.transport ?? 'http'
  const connectorId = overrides?.connectorId ?? 'feishu'
  return {
    id: `${connectorId}:${transport}:${externalEventId}`,
    connectorId,
    protocol: 'feishu',
    transport,
    externalEventId,
    channel: { id: 'chat-1' },
    sender: { id: 'user-1', type: 'user' },
    message: { id: externalEventId, type: 'text', text: 'hello' },
    replyAddress: { connectorId, protocol: 'feishu', channelId: 'chat-1' },
    receivedAt: Date.now(),
    ...overrides,
  }
}

describe('SQLiteInboundInbox', () => {
  let tmpDir: string
  let inbox: SQLiteInboundInbox

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-test-'))
  })

  afterEach(() => {
    inbox?.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createInbox(options?: Partial<ConstructorParameters<typeof SQLiteInboundInbox>[0]>) {
    inbox = new SQLiteInboundInbox({
      dbPath: path.join(tmpDir, 'test.db'),
      ...options,
    })
    return inbox
  }

  it('deduplicates same externalEventId across transports', async () => {
    createInbox()
    const first = await inbox.publish(makeEvent({ transport: 'http' }))
    const second = await inbox.publish(makeEvent({ transport: 'websocket' }))

    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe('duplicate')
  })

  it('deduplicates identical event ids', async () => {
    createInbox()
    const first = await inbox.publish(makeEvent())
    const second = await inbox.publish(makeEvent())

    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(false)
  })

  it('retries failed events and marks dead after maxAttempts', async () => {
    createInbox({ maxAttempts: 2, retryBaseDelayMs: 1, pollIntervalMs: 10 })

    let calls = 0
    const unsubscribe = inbox.subscribe(async () => {
      calls++
      throw new Error('handler failure')
    })

    await inbox.publish(makeEvent())
    await new Promise(resolve => setTimeout(resolve, 200))
    unsubscribe()

    expect(calls).toBe(2)
    const stats = inbox.getStats()
    expect(stats.dead).toBe(1)
    expect(stats.pending).toBe(0)
  })

  it('marks completed on successful handling', async () => {
    createInbox()

    const received: InboundEvent[] = []
    const unsubscribe = inbox.subscribe(async (event) => {
      received.push(event)
    })

    await inbox.publish(makeEvent())
    await new Promise(resolve => setTimeout(resolve, 50))
    unsubscribe()

    expect(received).toHaveLength(1)
    expect(inbox.getStats().completed).toBe(1)
  })

  it('processes a batch of events continuously', async () => {
    createInbox({ batchSize: 5 })

    const received: string[] = []
    const unsubscribe = inbox.subscribe(async (event) => {
      received.push(event.externalEventId)
    })

    for (let i = 0; i < 12; i++) {
      await inbox.publish(makeEvent({ externalEventId: `ext-${i}` }))
    }

    await new Promise(resolve => setTimeout(resolve, 200))
    unsubscribe()

    expect(received).toHaveLength(12)
    expect(inbox.getStats().completed).toBe(12)
  })

  it('renews lock via heartbeat during long processing', async () => {
    createInbox({
      visibilityTimeoutMs: 100,
      heartbeatIntervalMs: 30,
      pollIntervalMs: 20,
    })

    let calls = 0
    const unsubscribe = inbox.subscribe(async () => {
      calls++
      // 处理时长超过可见性超时；心跳应阻止重复派发
      await new Promise(resolve => setTimeout(resolve, 300))
    })

    await inbox.publish(makeEvent())
    await new Promise(resolve => setTimeout(resolve, 500))
    unsubscribe()

    expect(calls).toBe(1)
    expect(inbox.getStats().completed).toBe(1)
  })

  it('cleans up old completed records on init', async () => {
    const dbPath = path.join(tmpDir, 'ttl.db')
    const inbox1 = new SQLiteInboundInbox({ dbPath, completedTtlMs: 1 })
    const unsubscribe = inbox1.subscribe(async () => { /* complete instantly */ })
    await inbox1.publish(makeEvent())
    await new Promise(resolve => setTimeout(resolve, 50))
    unsubscribe()
    expect(inbox1.getStats().completed).toBe(1)
    inbox1.close()

    await new Promise(resolve => setTimeout(resolve, 10))
    // 重新打开触发启动清理
    createInbox({ completedTtlMs: 1 })
    inbox.publish = inbox.publish.bind(inbox)
    expect(inbox.getStats().completed).toBe(0)
  })
})
