import { nanoid } from 'nanoid'
import { logger } from '../../primitives/logger'
import type { InboundEvent, InboundInbox } from '../connector/inbound/types'
import type { CronJob, CronJobStore } from './types'
import { nextOccurrence } from './cron-expr'

export interface CronSchedulerOptions {
  store: CronJobStore
  inbox: InboundInbox
  tickIntervalMs?: number
}

export class CronScheduler {
  private readonly store: CronJobStore
  private readonly inbox: InboundInbox
  private readonly tickIntervalMs: number
  private timer?: ReturnType<typeof setInterval>
  private ticking = false
  private readonly inFlight = new Set<string>()

  constructor(options: CronSchedulerOptions) {
    this.store = options.store
    this.inbox = options.inbox
    this.tickIntervalMs = options.tickIntervalMs ?? 10_000
  }

  start(): void {
    if (this.timer) return
    const jobCount = this.store.listAll().length
    logger.info('CronScheduler', `Started: ${jobCount} jobs, tick every ${this.tickIntervalMs}ms`)
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  async tick(): Promise<number> {
    if (this.ticking) return 0
    this.ticking = true

    let fired = 0
    try {
      const now = Date.now()
      const dueJobs = this.store.listDue(now)

      for (const job of dueJobs) {
        if (this.inFlight.has(job.id)) continue
        try {
          this.inFlight.add(job.id)
          await this.fireJob(job, now)
          fired++
        } finally {
          this.inFlight.delete(job.id)
        }
      }
    } finally {
      this.ticking = false
    }

    return fired
  }

  async triggerJob(jobId: string): Promise<void> {
    const job = this.store.getById(jobId)
    if (!job) throw new Error(`Job not found: ${jobId}`)
    if (this.inFlight.has(jobId)) {
      logger.warn('CronScheduler', `Job "${job.name}" (${jobId}) already in flight, skipping`)
      return
    }
    this.inFlight.add(jobId)
    try {
      await this.fireJob(job, Date.now())
    } finally {
      this.inFlight.delete(jobId)
    }
  }

  private async fireJob(job: CronJob, now: number): Promise<void> {
    if (!job.schedule) {
      logger.warn('CronScheduler', `Job "${job.name}" (${job.id}) has no schedule, skipping`)
      return
    }

    const eventId = `cron-${job.id}-${now}`
    // Each execution gets its own unique conversation to avoid context pollution.
    // If job.conversationId is explicitly set, the user wants to reuse that conversation.
    const channelId = job.conversationId || `cron-${job.id}-${nanoid(8)}`
    const event: InboundEvent = {
      id: `cron:${job.id}:${now}`,
      connectorId: '__cron__',
      protocol: 'task-trigger',
      transport: 'internal',
      externalEventId: eventId,
      channel: {
        id: channelId,
        type: 'cron',
      },
      sender: {
        id: 'cron-scheduler',
        type: 'bot',
      },
      message: {
        id: eventId,
        type: 'text',
        text: job.prompt,
        raw: { cronJobId: job.id, cronJobName: job.name },
      },
      replyAddress: {
        connectorId: '__cron__',
        protocol: 'task-trigger',
        channelId,
      },
      receivedAt: now,
      agentType: job.agentType,
    }

    // Mark next run BEFORE publishing to prevent concurrent triggers.
    // If the process crashes after this point, the job will skip this execution
    // and run at the next scheduled time — acceptable tradeoff for atomicity.
    const nextRun = nextOccurrence(job.schedule, new Date(now)).getTime()
    this.store.markRun(job.id, now, nextRun)

    // Compute conversation ID (same formula as DefaultConversationResolver)
    const conversationId = `connector:${event.connectorId}:channel:${event.channel.id}`

    this.store.logExecution({
      jobId: job.id,
      status: 'triggered',
      triggeredAt: now,
      completedAt: null,
      duration: null,
      conversationId,
      error: null,
      eventId: event.id,
    })

    try {
      const result = await this.inbox.publish(event)

      const duration = Date.now() - now
      this.store.logExecution({
        jobId: job.id,
        status: 'completed',
        triggeredAt: now,
        completedAt: Date.now(),
        duration,
        conversationId,
        error: null,
        eventId: event.id,
      })

      logger.info('CronScheduler', `Completed job "${job.name}" (${job.id}) in ${duration}ms, accepted: ${result.accepted}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const duration = Date.now() - now
      logger.error('CronScheduler', `Failed job "${job.name}" (${job.id}) after ${duration}ms: ${message}`)
      this.store.logExecution({
        jobId: job.id,
        status: 'failed',
        triggeredAt: now,
        completedAt: Date.now(),
        duration,
        conversationId,
        error: message,
        eventId: event.id,
      })
      throw error
    }
  }
}
