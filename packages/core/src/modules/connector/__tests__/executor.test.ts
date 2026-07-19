import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorToolExecutor } from '../executor'
import type { ConnectorDefinition, ToolDefinition } from '../types'

function makeConnector(overrides?: Partial<ConnectorDefinition>): ConnectorDefinition {
  return {
    id: 'test-api',
    name: 'Test API',
    version: '1.0.0',
    description: 'test',
    enabled: true,
    variables: { api_key: 'secret-key' },
    auth: { type: 'none', config: {} },
    tools: [],
    ...overrides,
  }
}

function makeHttpTool(overrides?: Partial<ToolDefinition> & { url?: string }): ToolDefinition {
  return {
    name: 'call',
    description: 'test call',
    executor: 'http',
    executor_config: {
      url: overrides?.url ?? 'https://api.example.com/data',
      method: 'POST',
      body: { text: '{{input.text}}' },
    },
    ...overrides,
  }
}

describe('ConnectorToolExecutor HTTP', () => {
  let executor: ConnectorToolExecutor
  const fetchMock = vi.fn()

  beforeEach(() => {
    executor = new ConnectorToolExecutor(async () => ({ api_key: 'secret-key' }))
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockJsonResponse(status: number, data: unknown) {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => data,
      text: async () => JSON.stringify(data),
    })
  }

  it('executes http tool and returns data', async () => {
    mockJsonResponse(200, { result: 'ok' })
    const response = await executor.execute(makeConnector(), makeHttpTool(), { text: 'hello' })

    expect(response.success).toBe(true)
    expect(response.result).toEqual({ result: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/data')
    expect(JSON.parse(init.body)).toEqual({ text: 'hello' })
  })

  it('truncates long error responses', async () => {
    mockJsonResponse(500, { error: 'x'.repeat(2000) })
    const response = await executor.execute(makeConnector(), makeHttpTool(), { text: 'hello' })

    expect(response.success).toBe(false)
    expect(response.error!.length).toBeLessThan(600)
  })

  it('rejects URLs outside allowed_domains', async () => {
    const connector = makeConnector({ allowed_domains: ['example.com'] })
    const tool = makeHttpTool({ url: 'https://evil.attacker.com/steal' })
    const response = await executor.execute(connector, tool, {})

    expect(response.success).toBe(false)
    expect(response.error).toContain('not in allowed_domains')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows subdomains of allowed_domains', async () => {
    mockJsonResponse(200, { ok: true })
    const connector = makeConnector({ allowed_domains: ['example.com'] })
    const tool = makeHttpTool({ url: 'https://api.example.com/data' })
    const response = await executor.execute(connector, tool, {})

    expect(response.success).toBe(true)
  })

  it('deduplicates concurrent token refreshes', async () => {
    const connector = makeConnector({
      auth: {
        type: 'custom',
        config: {
          token_url: 'https://auth.example.com/token',
          token_method: 'POST',
        },
      },
    })

    // token 刷新响应
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ access_token: 'tok-1', expires_in: 7200 }),
      text: async () => '',
    })

    const [t1, t2, t3] = await Promise.all([
      executor.getToken('test-api', connector),
      executor.getToken('test-api', connector),
      executor.getToken('test-api', connector),
    ])

    expect(t1).toBe('tok-1')
    expect(t2).toBe('tok-1')
    expect(t3).toBe('tok-1')
    // 三个并发请求只触发一次刷新
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('invalidates token cache on 401', async () => {
    const connector = makeConnector({
      auth: {
        type: 'custom',
        config: { token_url: 'https://auth.example.com/token' },
      },
      tools: [makeHttpTool()],
    })
    const tool = makeHttpTool()

    // 第一次：token 刷新成功 + API 返回 401
    fetchMock
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: 'revoked-token', expires_in: 7200 }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: false, status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'unauthorized' }),
        text: async () => '',
      })
      // 第二次调用：缓存已失效 → 重新刷新 token + API 成功
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: 'fresh-token', expires_in: 7200 }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
        text: async () => '',
      })

    const first = await executor.execute(connector, tool, {})
    expect(first.success).toBe(false)

    const second = await executor.execute(connector, tool, {})
    expect(second.success).toBe(true)
    // 4 次 fetch：刷新 + 401 + 重新刷新 + 成功
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
