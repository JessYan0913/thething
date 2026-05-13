// ============================================================
// Connector Tools API
// ============================================================

import { Hono } from 'hono'
import { getServerRuntime } from '../../runtime'

const app = new Hono()

interface ConnectorToolInvocationBody {
  connectorId: string
  toolName: string
  input?: Record<string, unknown>
}

app.post('/call', async (c) => {
  try {
    const body = await c.req.json() as ConnectorToolInvocationBody

    if (!body.connectorId || !body.toolName) {
      return c.json(
        { success: false, error: 'Missing connectorId or toolName' },
        400
      )
    }

    const reg = (await getServerRuntime()).connectorRegistry

    const result = await reg.callTool({
      connectorId: body.connectorId,
      toolName: body.toolName,
      input: body.input || {},
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
    const connectorId = c.req.query('connectorId')

    const reg = (await getServerRuntime()).connectorRegistry

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
          connectorId,
          name: connector.name,
          version: connector.version,
          description: connector.description,
          enabled: connector.enabled,
          tools: connector.tools.map(t => ({
            name: t.name,
            toolName: t.name,
            description: t.description,
            inputSchema: t.input_schema,
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
              connectorId: id,
              name: connector.name,
              version: connector.version,
              enabled: connector.enabled,
              toolCount: connector.tools.length,
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
