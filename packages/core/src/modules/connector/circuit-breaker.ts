// ============================================================
// 熔断器 - Circuit Breaker 模式
// ============================================================

import { logger } from '../../primitives/logger';

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  failureThreshold: number
  successThreshold: number
  timeoutMs: number
}

const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 60000,
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public readonly state: CircuitState) {
    super(message)
    this.name = 'CircuitBreakerError'
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private successCount = 0
  private lastFailureTime = 0
  private options: CircuitBreakerOptions

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...options }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState()

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  getState(): CircuitState {
    if (this.state === 'open' && this.shouldTransitionToHalfOpen()) {
      this.state = 'half-open'
      this.successCount = 0
      logger.debug('CircuitBreaker', 'Transitioned to half-open')
    }
    return this.state
  }

  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = 0
  }

  private checkState(): void {
    const currentState = this.getState()

    if (currentState === 'open') {
      throw new CircuitBreakerError(
        'Circuit breaker is open, request rejected',
        'open'
      )
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++
      if (this.successCount >= this.options.successThreshold) {
        this.state = 'closed'
        this.failureCount = 0
        this.successCount = 0
        logger.debug('CircuitBreaker', 'Transitioned to closed (recovered)')
      }
    } else if (this.state === 'closed') {
      this.failureCount = 0
    }
  }

  private onFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.state === 'half-open') {
      this.state = 'open'
      this.successCount = 0
      logger.debug('CircuitBreaker', 'Transitioned to open (from half-open)')
    } else if (this.state === 'closed' && this.failureCount >= this.options.failureThreshold) {
      this.state = 'open'
      logger.debug('CircuitBreaker', 'Transitioned to open (failure threshold reached)')
    }
  }

  private shouldTransitionToHalfOpen(): boolean {
    return Date.now() - this.lastFailureTime >= this.options.timeoutMs
  }
}

export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>()

  get(connectorId: string): CircuitBreaker {
    if (!this.breakers.has(connectorId)) {
      this.breakers.set(connectorId, new CircuitBreaker())
    }
    return this.breakers.get(connectorId)!
  }

  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers)
  }

  reset(connectorId: string): void {
    this.breakers.get(connectorId)?.reset()
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset()
    }
  }
}
