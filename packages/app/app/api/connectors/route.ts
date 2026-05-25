import { getServerContext } from '@/lib/runtime';
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
