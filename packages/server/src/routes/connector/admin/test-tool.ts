// ============================================================
// Connector Admin Test Tool API
// ============================================================

import { Hono } from 'hono'
import { getServerRuntime } from '../../../runtime'

const app = new Hono()

interface ConnectorToolInvocationBody {
  connectorId: string
  toolName: string
  input?: Record<string, unknown>
}

app.post('/', async (c) => {
  try {
    const body = await c.req.json() as ConnectorToolInvocationBody

    if (!body.connectorId || !body.toolName) {
      return c.json(
        { success: false, error: 'Missing connectorId or toolName' },
        400
      )
    }

    const reg = (await getServerRuntime()).connectorRegistry

    const startTime = Date.now()
    const result = await reg.callTool({
      connectorId: body.connectorId,
      toolName: body.toolName,
      input: body.input || {},
    })

    return c.json({
      success: true,
      data: {
        ...result,
        timing: {
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        },
        request: {
          connectorId: body.connectorId,
          toolName: body.toolName,
          input: body.input,
        },
      },
    })
  } catch (error) {
    console.error('[Admin API] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500
    )
  }
})

export default app
