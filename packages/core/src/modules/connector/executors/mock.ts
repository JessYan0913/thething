// ============================================================
// Mock Executor - 用于测试，不需要真实请求
// ============================================================

import type { MockExecutorConfig, ExecutorResult } from '../types';
import { renderObject } from '../template';

export class MockExecutor {
  async execute(
    config: MockExecutorConfig,
    input: Record<string, unknown>
  ): Promise<ExecutorResult> {
    const startTime = Date.now()

    if (config.delay_ms && config.delay_ms > 0) {
      await new Promise(resolve => setTimeout(resolve, config.delay_ms))
    }

    if (config.error) {
      return {
        success: false,
        error: config.error,
        metadata: { duration_ms: Date.now() - startTime },
      }
    }

    const response = typeof config.response === 'function'
      ? config.response(input)
      : config.response

    const result = response === 'ECHO'
      ? { echoed: input, timestamp: Date.now() }
      : renderObject(response, { input })

    return {
      success: true,
      data: result,
      metadata: { duration_ms: Date.now() - startTime, mocked: true },
    }
  }
}
