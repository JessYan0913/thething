// ============================================================
// Connector Admin Test Tool API
// ============================================================

import { Hono } from 'hono'
import { getConnectorRegistry, type ToolCallRequest } from '@thething/core'

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = await c.req.json() as ToolCallRequest

    if (!body.connector_id || !body.tool_name) {
      return c.json(
        { success: false, error: 'Missing connector_id or tool_name' },
        400
      )
    }

    const reg = await getConnectorRegistry()

    const startTime = Date.now()
    const result = await reg.callTool({
      connector_id: body.connector_id,
      tool_name: body.tool_name,
      tool_input: body.tool_input || {},
    })

    return c.json({
      success: true,
      data: {
        ...result,
        timing: {
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        },
        request: {
          connector_id: body.connector_id,
          tool_name: body.tool_name,
          tool_input: body.tool_input,
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