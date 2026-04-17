// ============================================================
// Connector 工具测试 API
// POST /api/connector/admin/test-tool
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { ConnectorRegistry } from '@/lib/connector/registry'
import type { ToolCallRequest } from '@/lib/connector/types'

const CONNECTOR_CONFIG_DIR = path.join(process.cwd(), 'connectors')

let registry: ConnectorRegistry | null = null

async function getRegistry(): Promise<ConnectorRegistry> {
  if (!registry) {
    registry = new ConnectorRegistry(CONNECTOR_CONFIG_DIR)
    await registry.initialize()
  }
  return registry
}

export async function POST(req: NextRequest) {
  try {
    const body: ToolCallRequest & { timeout_ms?: number } = await req.json()

    if (!body.connector_id || !body.tool_name) {
      return NextResponse.json(
        { success: false, error: 'Missing connector_id or tool_name' },
        { status: 400 }
      )
    }

    const reg = await getRegistry()

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