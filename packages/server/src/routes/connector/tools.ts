// ============================================================
// Connector Tools API
// ============================================================

import { Hono } from 'hono'
import { getConnectorRegistry, type ToolCallRequest } from '@the-thing/core'

const app = new Hono()

app.post('/call', async (c) => {
  try {
    const body = await c.req.json() as ToolCallRequest

    if (!body.connector_id || !body.tool_name) {
      return c.json(
        { success: false, error: 'Missing connector_id or tool_name' },
        400
      )
    }

    const reg = await getConnectorRegistry()

    const result = await reg.callTool({
      connector_id: body.connector_id,
      tool_name: body.tool_name,
      tool_input: body.tool_input || {},
    })

    return c.json(result, result.success ? 200 : 400)
  } catch (error) {
    console.error('[Connector API] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500
    )
  }
})

app.get('/', async (c) => {
  try {
    const connectorId = c.req.query('connector_id')

    const reg = await getConnectorRegistry()

    if (connectorId) {
      const connector = reg.getDefinition(connectorId)
      if (!connector) {
        return c.json(
          { success: false, error: `Connector not found: ${connectorId}` },
          404
        )
      }

      return c.json({
        success: true,
        data: {
          connector_id: connectorId,
          name: connector.name,
          version: connector.version,
          description: connector.description,
          enabled: connector.enabled,
          tools: connector.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          })),
        },
      })
    } else {
      return c.json({
        success: true,
        data: {
          connectors: reg.getConnectorIds().map(id => {
            const connector = reg.getDefinition(id)!
            return {
              connector_id: id,
              name: connector.name,
              version: connector.version,
              enabled: connector.enabled,
              tool_count: connector.tools.length,
            }
          }),
        },
      })
    }
  } catch (error) {
    console.error('[Connector API] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500
    )
  }
})

export default app