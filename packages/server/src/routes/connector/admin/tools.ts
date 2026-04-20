// ============================================================
// Connector Admin Tools API
// ============================================================

import { Hono } from 'hono'
import { getConnectorRegistry } from '@the-thing/core'

const app = new Hono()

app.get('/', async (c) => {
  try {
    const reg = await getConnectorRegistry()
    const connectorIds = reg.getConnectorIds()

    const tools: Array<{
      connector_id: string
      connector_name: string
      tool_name: string
      tool_description: string
      input_schema: unknown
      executor: string
      timeout_ms?: number
      retryable?: boolean
    }> = []

    for (const connectorId of connectorIds) {
      const connector = reg.getDefinition(connectorId)

      if (!connector || !connector.enabled) {
        continue
      }

      for (const tool of connector.tools) {
        tools.push({
          connector_id: connectorId,
          connector_name: connector.name,
          tool_name: tool.name,
          tool_description: tool.description,
          input_schema: tool.input_schema,
          executor: tool.executor,
          timeout_ms: tool.timeout_ms,
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
            tool_count: connector.tools.length,
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