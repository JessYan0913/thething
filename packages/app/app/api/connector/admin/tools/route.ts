import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const rt = await getServerRuntime();
    const reg = rt.connectorRegistry;
    const connectorIds = reg.getConnectorIds();

    const tools: Array<{
      connectorId: string;
      connectorName: string;
      toolName: string;
      toolDescription: string;
      inputSchema: unknown;
      executor: string;
      timeoutMs?: number;
    }> = [];

    for (const connectorId of connectorIds) {
      const connector = reg.getDefinition(connectorId);

      if (!connector || !connector.enabled) {
        continue;
      }

      for (const tool of connector.tools) {
        tools.push({
          connectorId,
          connectorName: connector.name,
          toolName: tool.name,
          toolDescription: tool.description,
          inputSchema: tool.input_schema,
          executor: tool.executor,
          timeoutMs: tool.timeout_ms,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        tools,
        total: tools.length,
        connectors: connectorIds.map(id => {
          const connector = reg.getDefinition(id)!;
          return {
            id,
            name: connector.name,
            enabled: connector.enabled,
            toolCount: connector.tools.length,
          };
        }),
      },
    });
  } catch (error) {
    console.error('[Admin Tools API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
