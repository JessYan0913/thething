// ============================================================
// Connector 工具测试 API
// POST /api/connector/admin/test-tool
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getConnectorRegistry } from '@/lib/connector'
import type { ToolCallRequest } from '@/lib/connector/types'

export async function POST(req: NextRequest) {
  try {
    const body: ToolCallRequest = await req.json()

    if (!body.connector_id || !body.tool_name) {
      return NextResponse.json(
        { success: false, error: 'Missing connector_id or tool_name' },
        { status: 400 }
      )
    }

    const reg = await getConnectorRegistry()

    const startTime = Date.now()
    const result = await reg.callTool({
      connector_id: body.connector_id,
      tool_name: body.tool_name,
      tool_input: body.tool_input || {},
    })

    return NextResponse.json({
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
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}