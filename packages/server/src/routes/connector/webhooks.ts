// ============================================================
// Connector Webhooks API - connectorId 路由
// ============================================================

import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getServerRuntime } from '../../runtime'

const app = new Hono()

// 通用 POST 处理器
app.post('/:connectorId', async (c) => {
  const startTime = Date.now()
  const connectorId = c.req.param('connectorId')

  console.log('[Webhook] Received request for connector:', connectorId)

  try {
    const url = new URL(c.req.url)
    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })

    const body = await c.req.text()

    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value
    })

    const runtime = (await getServerRuntime()).connectorInbound
    if (!runtime) {
      return c.json({ success: false, error: 'Connector inbound runtime not initialized' }, 503)
    }

    const result = await runtime.gateway.acceptHttp({
      method: c.req.method,
      path: url.pathname,
      connectorId,
      params: { connectorId },
      query,
      headers,
      body,
      transport: 'http',
    })

    if (typeof result.body === 'string') {
      return new Response(result.body, { status: result.status })
    }

    console.log('[Webhook] Gateway result:', result.eventId, result.reason ?? 'accepted', 'duration:', Date.now() - startTime, 'ms')
    return c.json(result.body ?? {
      success: result.accepted,
      event_id: result.eventId,
      error: result.reason,
    }, toHonoStatus(result.status))

  } catch (error) {
    console.error('[Webhook] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500
    )
  }
})

// GET 用于 Webhook URL 验证
app.get('/:connectorId', async (c) => {
  const connectorId = c.req.param('connectorId')

  const url = new URL(c.req.url)
  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    query[key] = value
  })

  try {
    if (query.signature && query.timestamp && query.nonce && query.echostr) {
      const runtime = (await getServerRuntime()).connectorInbound
      if (runtime) {
        const result = await runtime.gateway.acceptHttp({
          method: c.req.method,
          path: url.pathname,
          connectorId,
          params: { connectorId },
          query,
          headers: {},
          body: query.echostr,
          transport: 'http',
        })
        if (typeof result.body === 'string') {
          return new Response(result.body, { status: result.status })
        }
        return c.json(result.body ?? { success: result.accepted, error: result.reason }, toHonoStatus(result.status))
      }

      return c.json({ success: false, error: 'URL verification failed' }, 400)
    }

    return c.json({
      status: 'ready',
      service: `${connectorId}-webhook`,
      connectorId,
      message: 'Connector webhook endpoint is ready',
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('[Webhook] GET Error:', error)
    return c.json(
      { status: 'error', error: error instanceof Error ? error.message : String(error) },
      500
    )
  }
})

export default app

function toHonoStatus(status: number): ContentfulStatusCode {
  if (status === 200 || status === 400 || status === 404 || status === 500 || status === 503) {
    return status
  }
  return status >= 400 ? 500 : 200
}
