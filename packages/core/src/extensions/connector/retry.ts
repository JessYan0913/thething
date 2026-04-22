// ============================================================
// 重试策略 - 指数退避
// ============================================================

export interface RetryOptions {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  jitter: boolean
  retryableErrors?: string[]
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
}

export interface Retryable {
  (): Promise<unknown>
}

export async function withRetry(
  fn: Retryable,
  options: Partial<RetryOptions> = {}
): Promise<unknown> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options }
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (opts.retryableErrors && opts.retryableErrors.length > 0) {
        const errorMsg = lastError.message
        const isRetryable = opts.retryableErrors.some(
          pattern => errorMsg.includes(pattern)
        )
        if (!isRetryable) {
          throw lastError
        }
      }

      if (attempt === opts.maxRetries) {
        throw lastError
      }

      const delay = calculateBackoff(attempt, opts)
      console.log(
        `[Retry] Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`
      )
      await sleep(delay)
    }
  }

  throw lastError ?? new Error('Unexpected retry exhaustion')
}

function calculateBackoff(attempt: number, options: RetryOptions): number {
  const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt)
  const delay = Math.min(exponentialDelay, options.maxDelayMs)

  if (options.jitter) {
    return delay * (0.5 + Math.random() * 0.5)
  }

  return delay
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
