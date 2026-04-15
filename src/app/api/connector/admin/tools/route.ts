// ============================================================
// Connector 工具列表 API - 获取所有可用的 Connector 工具
// GET /api/connector/admin/tools
// ============================================================

import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { ConnectorRegistry } from '@/lib/connector/registry'

const CONNECTOR_CONFIG_DIR = path.join(process.cwd(), 'connectors')

async function getCredentials(connectorId: string): Promise<Record<string, string>> {
  const configPath = path.join(
    CONNECTOR_CONFIG_DIR,
    'connectors',
    `${connectorId}-config.json`
  )
  if (!fs.existsSync(configPath)) return {}
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  return config.credentials || {}
}

let registry: ConnectorRegistry | null = null

async function getRegistry(): Promise<ConnectorRegistry> {
  if (!registry) {
    registry = new ConnectorRegistry(CONNECTOR_CONFIG_DIR, getCredentials)
    await registry.initialize()
  }
  return registry
}

export async function GET() {
  try {
    const reg = await getRegistry()
    const connectorIds = reg.getConnectorIds()

    const tools: Array<{
      connector_id: string
      connector_name: string
      tool_name: string
      tool_description: string
      input_schema: any
      executor: string
      timeout_ms?: number
      retryable?: boolean
    }> = []

    for (const connectorId of connectorIds) {
      const manifest = reg.getManifest(connectorId)
      const config = reg.getConfig(connectorId)

      if (!manifest || !config || !config.enabled) {
        continue
      }

      for (const tool of manifest.tools) {
        tools.push({
          connector_id: connectorId,
          connector_name: manifest.name,
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
          const manifest = reg.getManifest(id)!
          const config = reg.getConfig(id)!
          return {
            id,
            name: manifest.name,
            enabled: config.enabled,
            tool_count: manifest.tools.length,
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
