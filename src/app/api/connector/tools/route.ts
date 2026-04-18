// ============================================================
// Connector 工具调用 API
// POST /api/connector/tools/call
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getConnectorRegistry } from '@/lib/connector'
import type { ToolCallRequest } from '@/lib/connector/types'

export async function POST(req: NextRequest) {
  try {
    const body: ToolCallRequest = await req.json()

    // 验证请求
    if (!body.connector_id || !body.tool_name) {
      return NextResponse.json(
        { success: false, error: 'Missing connector_id or tool_name' },
        { status: 400 }
      )
    }

    const reg = await getConnectorRegistry()

    // 调用工具
    const result = await reg.callTool({
      connector_id: body.connector_id,
      tool_name: body.tool_name,
      tool_input: body.tool_input || {},
    })

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    })
  } catch (error) {
    console.error('[Connector API] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const connectorId = searchParams.get('connector_id')

    const reg = await getConnectorRegistry()

    if (connectorId) {
      // 获取指定 Connector 的工具列表
      const connector = reg.getDefinition(connectorId)
      if (!connector) {
        return NextResponse.json(
          { success: false, error: `Connector not found: ${connectorId}` },
          { status: 404 }
        )
      }

      return NextResponse.json({
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
      // 获取所有已加载的 Connector
      return NextResponse.json({
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
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}