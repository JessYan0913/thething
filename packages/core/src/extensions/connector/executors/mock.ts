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
      : renderMockValue(response, input)

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

function renderMockValue(value: unknown, input: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return renderMockTemplate(value, input)
  }

  if (Array.isArray(value)) {
    return value.map(item => renderMockValue(item, input))
  }

  if (value && typeof value === 'object') {
    const rendered: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      rendered[key] = renderMockValue(child, input)
    }
    return rendered
  }

  return value
}

function renderMockTemplate(template: string, input: Record<string, unknown>): string {
  const now = new Date()

  return template
    .replace(/\{\{timestamp\}\}/g, () => String(Date.now()))
    .replace(/\{\{iso_timestamp\}\}/g, () => now.toISOString())
    .replace(/\{\{uuid\}\}/g, () => crypto.randomUUID())
    .replace(/\{\{input\.([\w.]+)\}\}/g, (_, path) => {
      return stringifyTemplateValue(resolvePath(input, path))
    })
}

function resolvePath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, source)
}

function stringifyTemplateValue(value: unknown): string {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value)
  }
  return String(value ?? '')
}
