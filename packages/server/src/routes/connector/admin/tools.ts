// ============================================================
// Connector Admin Tools API
// ============================================================

import { Hono } from 'hono'
import { getServerRuntime } from '../../../runtime'

const app = new Hono()

app.get('/', async (c) => {
  try {
    const reg = (await getServerRuntime()).connectorRegistry
    const connectorIds = reg.getConnectorIds()

    const tools: Array<{
      connectorId: string
      connectorName: string
      toolName: string
      toolDescription: string
      inputSchema: unknown
      executor: string
      timeoutMs?: number
      retryable?: boolean
    }> = []

    for (const connectorId of connectorIds) {
      const connector = reg.getDefinition(connectorId)

      if (!connector || !connector.enabled) {
        continue
      }

      for (const tool of connector.tools) {
        tools.push({
          connectorId,
          connectorName: connector.name,
          toolName: tool.name,
          toolDescription: tool.description,
          inputSchema: tool.input_schema,
          executor: tool.executor,
          timeoutMs: tool.timeout_ms,
          retryable: tool.retryable,
        })
      }
    }

    return c.json({
      success: true,
      data: {
        tools,
        total: tools.length,
        connectors: connectorIds.map(id => {
          const connector = reg.getDefinition(id)!
          return {
            id,
            name: connector.name,
            enabled: connector.enabled,
            toolCount: connector.tools.length,
          }
        }),
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
