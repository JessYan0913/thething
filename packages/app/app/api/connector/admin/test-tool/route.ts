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

    const startTime = Date.now();
    const result = await reg.callTool({
      connectorId: body.connectorId,
      toolName: body.toolName,
      input: body.input || {},
    });

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        timing: {
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        },
        request: {
          connectorId: body.connectorId,
          toolName: body.toolName,
          input: body.input,
        },
      },
    });
  } catch (error) {
    console.error('[Admin Test Tool API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
