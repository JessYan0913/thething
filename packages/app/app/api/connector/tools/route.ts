import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      connectorId: string;
      toolName: string;
      input?: Record<string, unknown>;
    };

    if (!body.connectorId || !body.toolName) {
      return NextResponse.json(
        { success: false, error: 'Missing connectorId or toolName' },
        { status: 400 }
      );
    }

    const rt = await getServerRuntime();
    const reg = rt.connectorRegistry;

    const result = await reg.callTool({
      connectorId: body.connectorId,
      toolName: body.toolName,
      input: body.input || {},
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[Connector Tools API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectorId = searchParams.get('connectorId');

    const rt = await getServerRuntime();
    const reg = rt.connectorRegistry;

    if (connectorId) {
      const connector = reg.getDefinition(connectorId);
      if (!connector) {
        return NextResponse.json(
          { success: false, error: `Connector not found: ${connectorId}` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          connectorId,
          name: connector.name,
          version: connector.version,
          description: connector.description,
          enabled: connector.enabled,
          tools: connector.tools.map(t => ({
            name: t.name,
            toolName: t.name,
            description: t.description,
            inputSchema: t.input_schema,
          })),
        },
      });
    } else {
      return NextResponse.json({
        success: true,
        data: {
          connectors: reg.getConnectorIds().map(id => {
            const connector = reg.getDefinition(id)!;
            return {
              connectorId: id,
              name: connector.name,
              version: connector.version,
              enabled: connector.enabled,
              toolCount: connector.tools.length,
            };
          }),
        },
      });
    }
  } catch (error) {
    console.error('[Connector Tools API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
