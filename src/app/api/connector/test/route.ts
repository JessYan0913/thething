// ============================================================
// Connector 功能测试 API
// GET /api/connector/test - 测试所有 Connector 功能
// ============================================================

import { NextResponse } from 'next/server'
import { getConnectorRegistry } from '@/lib/connector'

export async function GET() {
  const results: Array<{
    step: string
    success: boolean
    data?: unknown
    error?: string
  }> = []

  try {
    const reg = await getConnectorRegistry()

    // 1. 列出所有已加载的 Connector
    const connectorIds = reg.getConnectorIds()
    results.push({
      step: '1-list-connectors',
      success: true,
      data: { connectors: connectorIds },
    })

    // 2. 测试 test-service 的 echo 工具
    const echoResult = await reg.callTool({
      connector_id: 'test-service',
      tool_name: 'echo',
      tool_input: { message: 'Hello Connector Gateway!' },
    })
    results.push({
      step: '2-test-echo-mock',
      success: echoResult.success,
      data: echoResult,
    })

    // 3. 测试 test-service 的 get_user_info 工具
    const userResult = await reg.callTool({
      connector_id: 'test-service',
      tool_name: 'get_user_info',
      tool_input: { userid: 'test-user-001' },
    })
    results.push({
      step: '3-test-get-user-info',
      success: userResult.success,
      data: userResult,
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
  } catch (error) {
    console.error('[Connector Test API] Error:', error)
    return NextResponse.json({
      summary: { total: results.length, passed: 0, failed: results.length },
      results: [...results, {
        step: 'error',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }],
    }, { status: 500 })
  }
}