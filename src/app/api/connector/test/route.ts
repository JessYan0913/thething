// ============================================================
// Connector 功能测试 API
// GET /api/connector/test - 测试所有 Connector 功能
// ============================================================

import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { ConnectorRegistry } from '@/lib/connector/registry'
import type { ToolCallRequest } from '@/lib/connector/types'

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
  const results: any[] = []
  const reg = await getRegistry()

  // 1. 列出所有已加载的 Connector
  const connectorIds = reg.getConnectorIds()
  results.push({
    step: '1-list-connectors',
    success: true,
    data: { connectors: connectorIds },
  })

  // 2. 测试 test_service_echo（Mock Executor）
  const echoResult = await reg.callTool({
    connector_id: 'test-service',
    tool_name: 'test_service_echo',
    tool_input: { content: 'Hello Connector Gateway!', delay_ms: 100 },
  })
  results.push({
    step: '2-test-echo-mock',
    success: echoResult.success,
    data: echoResult,
  })

  // 3. 测试 test_service_ping（HTTP Executor 到 httpbin.org）
  const pingResult = await reg.callTool({
    connector_id: 'test-service',
    tool_name: 'test_service_ping',
    tool_input: { message: 'test ping' },
  })
  results.push({
    step: '3-test-ping-http',
    success: pingResult.success,
    data: pingResult,
  })

  // 4. 测试 test_service_httpbin_get
  const getResult = await reg.callTool({
    connector_id: 'test-service',
    tool_name: 'test_service_httpbin_get',
    tool_input: { status_code: 200 },
  })
  results.push({
    step: '4-test-httpbin-get',
    success: getResult.success,
    data: getResult,
  })

  // 汇总
  const allSuccess = results.every(r => r.success)

  return NextResponse.json({
    summary: {
      total: results.length,
      passed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    },
    results,
    registry_info: {
      loaded_connectors: connectorIds,
      test_service_tools: reg.getTools('test-service').map(t => t.name),
    },
  }, {
    status: allSuccess ? 200 : 400,
  })
}
