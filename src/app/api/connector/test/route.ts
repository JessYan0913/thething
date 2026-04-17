// ============================================================
// Connector 功能测试 API
// GET /api/connector/test - 测试所有 Connector 功能
// ============================================================

import { NextResponse } from 'next/server'
import path from 'path'
import { ConnectorRegistry } from '@/lib/connector/registry'

const CONNECTOR_CONFIG_DIR = path.join(process.cwd(), 'connectors')

let registry: ConnectorRegistry | null = null

async function getRegistry(): Promise<ConnectorRegistry> {
  if (!registry) {
    registry = new ConnectorRegistry(CONNECTOR_CONFIG_DIR)
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

  // 2. 测试 test_echo（HTTP Executor 到 httpbin.org）
  const echoResult = await reg.callTool({
    connector_id: 'test-service',
    tool_name: 'test_echo',
    tool_input: { message: 'Hello Connector Gateway!' },
  })
  results.push({
    step: '2-test-echo-http',
    success: echoResult.success,
    data: echoResult,
  })

  // 3. 测试 test_ip_info
  const ipResult = await reg.callTool({
    connector_id: 'test-service',
    tool_name: 'test_ip_info',
    tool_input: {},
  })
  results.push({
    step: '3-test-ip-info',
    success: ipResult.success,
    data: ipResult,
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