// ============================================================
// Mock Executor - 用于测试，不需要真实请求
// ============================================================

import type { MockExecutorConfig, ExecutorResult } from '../types';

export class MockExecutor {
  /**
   * 执行 Mock 请求
   */
  async execute(
    config: MockExecutorConfig,
    input: Record<string, unknown>
  ): Promise<ExecutorResult> {
    const startTime = Date.now()

    // 模拟延迟
    if (config.delay_ms && config.delay_ms > 0) {
      await new Promise(resolve => setTimeout(resolve, config.delay_ms))
    }

    // 模拟错误
    if (config.error) {
      return {
        success: false,
        error: config.error,
        metadata: { duration_ms: Date.now() - startTime },
      }
    }

    // 返回配置的反响应，并混入输入
    const response = typeof config.response === 'function'
      ? config.response(input)
      : config.response

    // 常见的 echo 模式：将输入原样返回
    const result = response === 'ECHO'
      ? { echoed: input, timestamp: Date.now() }
      : response

    return {
      success: true,
      data: result,
      metadata: {
        duration_ms: Date.now() - startTime,
        mocked: true,
      },
    }
  }
}
