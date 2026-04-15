// ============================================================
// Connector 工具调用 API
// POST /api/connector/tools/call
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { ConnectorRegistry } from '@/lib/connector/registry'
import type { ToolCallRequest } from '@/lib/connector/types'

// Connector 配置文件目录
const CONNECTOR_CONFIG_DIR = path.join(process.cwd(), 'connectors')

// 简单的 credentials 获取函数（实际应该从加密存储或数据库获取）
async function getCredentials(connectorId: string): Promise<Record<string, string>> {
  const configPath = path.join(
    CONNECTOR_CONFIG_DIR,
    'connectors',
    `${connectorId}-config.json`
  )

  if (!fs.existsSync(configPath)) {
    console.warn(`[Connector API] Config not found for ${connectorId}`)
    return {}
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return config.credentials || {}
  } catch {
    return {}
  }
}

// 创建全局 Registry 实例
let registry: ConnectorRegistry | null = null

async function getRegistry(): Promise<ConnectorRegistry> {
  if (!registry) {
    registry = new ConnectorRegistry(CONNECTOR_CONFIG_DIR, getCredentials)
    await registry.initialize()
  }
  return registry
}

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

    const reg = await getRegistry()

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

    const reg = await getRegistry()

    if (connectorId) {
      // 获取指定 Connector 的工具列表
      const manifest = reg.getManifest(connectorId)
      if (!manifest) {
        return NextResponse.json(
          { success: false, error: `Connector not found: ${connectorId}` },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        data: {
          connector_id: connectorId,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          tools: manifest.tools.map(t => ({
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
            const manifest = reg.getManifest(id)!
            return {
              connector_id: id,
              name: manifest.name,
              version: manifest.version,
              tool_count: manifest.tools.length,
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
