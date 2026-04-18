// ============================================================
// Connector 工具列表 API - 获取所有可用的 Connector 工具
// GET /api/connector/admin/tools
// ============================================================

import { NextResponse } from 'next/server'
import { getConnectorRegistry } from '@/lib/connector'

export async function GET() {
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

    return NextResponse.json({
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
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}