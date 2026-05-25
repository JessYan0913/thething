import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const startTime = Date.now();
  const url = new URL(request.url);
  // Extract connectorId from the URL path: /api/connector/webhooks/[connectorId]
  const pathParts = url.pathname.split('/');
  const connectorId = pathParts[pathParts.length - 1];

  console.log('[Webhook] Received request for connector:', connectorId);

  try {
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const body = await request.text();

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const rt = await getServerRuntime();
    const inboundRuntime = rt.connectorInbound;
    if (!inboundRuntime) {
      return NextResponse.json({ success: false, error: 'Connector inbound runtime not initialized' }, { status: 503 });
    }

    const result = await inboundRuntime.gateway.acceptHttp({
      method: request.method,
      path: url.pathname,
      connectorId,
      params: { connectorId },
      query,
      headers,
      body,
      transport: 'http',
    });

    console.log('[Webhook] Gateway result:', result.eventId, result.reason ?? 'accepted', 'duration:', Date.now() - startTime, 'ms');

    return NextResponse.json(result.body ?? {
      success: result.accepted,
      event_id: result.eventId,
      error: result.reason,
    }, { status: result.status });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const connectorId = pathParts[pathParts.length - 1];

  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  try {
    if (query.signature && query.timestamp && query.nonce && query.echostr) {
      const rt = await getServerRuntime();
      const inboundRuntime = rt.connectorInbound;
      if (inboundRuntime) {
        const result = await inboundRuntime.gateway.acceptHttp({
          method: 'GET',
          path: url.pathname,
          connectorId,
          params: { connectorId },
          query,
          headers: {},
          body: query.echostr,
          transport: 'http',
        });
        if (typeof result.body === 'string') {
          return new Response(result.body, { status: result.status });
        }
        return NextResponse.json(result.body ?? { success: result.accepted, error: result.reason }, { status: result.status });
      }

      return NextResponse.json({ success: false, error: 'URL verification failed' }, { status: 400 });
    }

    return NextResponse.json({
      status: 'ready',
      service: `${connectorId}-webhook`,
      connectorId,
      message: 'Connector webhook endpoint is ready',
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[Webhook] GET Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
