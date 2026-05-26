import { getServerContext, reloadServerContext } from '@/lib/runtime';
import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const context = await getServerContext();
    const connectors = context.connectors.map((conn) => ({
      id: conn.id,
      name: conn.name,
      version: conn.version,
      description: conn.description,
      enabled: conn.enabled,
      base_url: conn.base_url,
      auth: conn.auth,
      inbound: conn.inbound,
      tools: conn.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        executor: t.executor,
        timeout_ms: t.timeout_ms,
        retryable: t.retryable,
        input_schema: t.input_schema,
      })) ?? [],
      toolCount: conn.tools?.length ?? 0,
      sourcePath: conn.sourcePath,
    }));

    return NextResponse.json({ connectors });
  } catch (error) {
    console.error('[Connectors API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load connectors' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 });
    }

    const context = await getServerContext();
    const connector = context.connectors.find((c) => c.id === id);
    if (!connector) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
    }

    if (!connector.sourcePath) {
      return NextResponse.json({ error: 'Connector has no source file' }, { status: 400 });
    }

    await fs.unlink(connector.sourcePath);
    await reloadServerContext();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Connectors API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete connector' }, { status: 500 });
  }
}
