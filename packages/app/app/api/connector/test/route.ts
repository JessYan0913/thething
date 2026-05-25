import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const results: Array<{
    step: string;
    success: boolean;
    data?: unknown;
    error?: string;
  }> = [];

  try {
    const rt = await getServerRuntime();
    const reg = rt.connectorRegistry;

    const connectorIds = reg.getConnectorIds();
    results.push({
      step: '1-list-connectors',
      success: true,
      data: { connectors: connectorIds },
    });

    const echoResult = await reg.callTool({
      connectorId: 'test-service',
      toolName: 'echo',
      input: { message: 'Hello Connector Gateway!' },
    });
    results.push({
      step: '2-test-echo-mock',
      success: echoResult.success,
      data: echoResult,
    });

    const userResult = await reg.callTool({
      connectorId: 'test-service',
      toolName: 'get_user_info',
      input: { userid: 'test-user-001' },
    });
    results.push({
      step: '3-test-get-user-info',
      success: userResult.success,
      data: userResult,
    });

    const allSuccess = results.every(r => r.success);

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
    }, { status: allSuccess ? 200 : 400 });
  } catch (error) {
    console.error('[Connector Test API] Error:', error);
    return NextResponse.json({
      summary: { total: results.length, passed: 0, failed: results.length },
      results: [...results, {
        step: 'error',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }],
    }, { status: 500 });
  }
}
