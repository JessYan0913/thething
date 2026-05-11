// ============================================================
// 入站事件队列 - 缓冲 Webhook 接收的消息，等待 Agent 处理
// ============================================================

import type { InboundMessageEvent } from '../types'

export interface QueuedEvent {
  event: InboundMessageEvent
  queuedAt: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  processingResult?: {
    success: boolean
    response?: string
    error?: string
  }
}

/**
 * 队列推送结果
 */
export interface QueuePushResult {
  eventId: string
  accepted: boolean
  reason?: 'queue_full' | 'duplicate'
  queueStats?: QueueStats
}

/**
 * 队列统计
 */
export interface QueueStats {
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  maxSize: number
}

/**
 * 入站事件队列（内存实现，单实例部署）
 * 生产环境可替换为 Redis 或消息队列
 */
export class InboundEventQueue {
  private queue: QueuedEvent[] = []
  private maxQueueSize = 100
  private processingCallbacks: Array<(event: InboundMessageEvent) => Promise<void>> = []
  private dropCount = 0
  private lastDropLogTime = 0

  /**
   * 推送事件到队列
   *
   * @returns QueuePushResult - 包含是否接受、原因和队列状态
   */
  async push(event: InboundMessageEvent): Promise<QueuePushResult> {
    // 1. 检查重复事件
    const existing = this.queue.find(e => e.event.event_id === event.event_id)
    if (existing) {
      return {
        eventId: event.event_id,
        accepted: false,
        reason: 'duplicate',
        queueStats: this.getStats(),
      }
    }

    // 2. 检查队列容量
    if (this.queue.length >= this.maxQueueSize) {
      // 优先清理已完成/失败的事件（不影响正在处理的）
      this.queue = this.queue.filter(e => e.status !== 'completed' && e.status !== 'failed')

      // 如果清理后仍然满，需要丢弃
      if (this.queue.length >= this.maxQueueSize) {
        // 记录丢弃统计（每 10 秒输出一次汇总日志）
        this.dropCount++
        const now = Date.now()
        if (now - this.lastDropLogTime > 10000) {
          console.warn(
            `[InboundEventQueue] Queue overflow: ${this.dropCount} events dropped in last 10s`,
            `Current stats:`, this.getStats()
          )
          this.dropCount = 0
          this.lastDropLogTime = now
        }

        // 优先丢弃最老的 pending 事件（而不是正在 processing 的）
        const pendingEvents = this.queue.filter(e => e.status === 'pending')
        if (pendingEvents.length > 0) {
          // 丢弃最老的 pending 事件
          const oldestPending = pendingEvents[0]
          this.queue = this.queue.filter(e => e !== oldestPending)
          console.warn(
            `[InboundEventQueue] Dropped oldest pending event: ${oldestPending.event.event_id}`
          )
        } else {
          // 极端情况：所有事件都在 processing，无法丢弃
          // 返回拒绝而不是丢弃 processing 事件
          return {
            eventId: event.event_id,
            accepted: false,
            reason: 'queue_full',
            queueStats: this.getStats(),
          }
        }
      }
    }

    // 3. 添加事件
    const queuedEvent: QueuedEvent = {
      event,
      queuedAt: Date.now(),
      status: 'pending',
    }

    this.queue.push(queuedEvent)

    console.log('[InboundEventQueue] Event queued:', event.event_id, 'connector:', event.connector_type)

    // 4. 触发处理回调
    this.triggerProcessing(event)

    return {
      eventId: event.event_id,
      accepted: true,
      queueStats: this.getStats(),
    }
  }

  /**
   * 注册事件处理回调
   * 用于连接 Agent Core 处理入站消息
   */
  onEvent(callback: (event: InboundMessageEvent) => Promise<void>): void {
    this.processingCallbacks.push(callback)
  }

  /**
   * 移除处理回调
   */
  offEvent(callback: (event: InboundMessageEvent) => Promise<void>): void {
    this.processingCallbacks = this.processingCallbacks.filter(cb => cb !== callback)
  }

  /**
   * 触发事件处理
   * 异步执行，不阻塞 push() 返回（解决飞书 webhook 超时问题）
   */
  private triggerProcessing(event: InboundMessageEvent): void {
    const queuedEvent = this.queue.find(e => e.event.event_id === event.event_id)
    if (!queuedEvent) return

    queuedEvent.status = 'processing'

    // 异步执行处理回调，不等待完成
    // 这样 push() 可以立即返回，webhook 不会超时
    Promise.resolve()
      .then(async () => {
        for (const callback of this.processingCallbacks) {
          try {
            await callback(event)
            queuedEvent.status = 'completed'
            queuedEvent.processingResult = { success: true }
          } catch (error) {
            queuedEvent.status = 'failed'
            queuedEvent.processingResult = {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }
            console.error('[InboundEventQueue] Processing failed:', event.event_id, error)
          }
        }
      })
      .catch((error) => {
        // 捕获未处理的异常
        queuedEvent.status = 'failed'
        queuedEvent.processingResult = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
        console.error('[InboundEventQueue] Unexpected processing error:', event.event_id, error)
      })
  }

  /**
   * 获取队列中的事件列表
   */
  getQueue(filter?: {
    status?: QueuedEvent['status']
    connector_type?: string
    limit?: number
  }): QueuedEvent[] {
    let result = [...this.queue]

    if (filter?.status) {
      result = result.filter(e => e.status === filter.status)
    }
    if (filter?.connector_type) {
      result = result.filter(e => e.event.connector_type === filter.connector_type)
    }

    result.sort((a, b) => b.queuedAt - a.queuedAt)

    if (filter?.limit) {
      result = result.slice(0, filter.limit)
    }

    return result
  }

  /**
   * 获取单个事件
   */
  getEvent(eventId: string): QueuedEvent | undefined {
    return this.queue.find(e => e.event.event_id === eventId)
  }

  /**
   * 获取队列统计
   */
  getStats(): QueueStats {
    return {
      total: this.queue.length,
      pending: this.queue.filter(e => e.status === 'pending').length,
      processing: this.queue.filter(e => e.status === 'processing').length,
      completed: this.queue.filter(e => e.status === 'completed').length,
      failed: this.queue.filter(e => e.status === 'failed').length,
      maxSize: this.maxQueueSize,
    }
  }

  /**
   * 清理已完成/失败的事件
   */
  cleanup(maxAgeMs = 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs
    const before = this.queue.length
    this.queue = this.queue.filter(e =>
      e.status === 'pending' || e.status === 'processing' || e.queuedAt > cutoff
    )
    return before - this.queue.length
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = []
  }
}