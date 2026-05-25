import { getServerRuntime } from '@/lib/runtime';
import {
  getMcpServerConfigs,
  getMcpServerConfig,
  addMcpServerConfig,
  updateMcpServerConfig,
  deleteMcpServerConfig,
  createMcpRegistry,
  type McpServerConfig,
} from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function getResourceRoot(): Promise<string> {
  const rt = await getServerRuntime();
  return rt.layout.resourceRoot;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const connect = searchParams.get('connect') === 'true';
    const resourceRoot = await getResourceRoot();

    if (name) {
      const config = await getMcpServerConfig(name, resourceRoot);
      if (!config) {
        return NextResponse.json({ error: 'Server not found' }, { status: 404 });
      }

      if (connect) {
        const registry = createMcpRegistry([config]);
        try {
          await registry.connectAll();
          const snapshot = registry.snapshot();
          await registry.disconnectAll();
          return NextResponse.json({ config, snapshot });
        } catch (error) {
          await registry.disconnectAll();
          return NextResponse.json({
            config,
            snapshot: {
              servers: [{ name: config.name, enabled: true, connected: false, toolCount: 0, error: String(error) }],
              totalTools: 0,
            },
          });
        }
      }

      return NextResponse.json({ config });
    }

    const configs = await getMcpServerConfigs(resourceRoot);
    return NextResponse.json({ servers: configs });
  } catch (error) {
    console.error('[MCP API] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as McpServerConfig;

    if (!body.name || !body.transport?.type) {
      return NextResponse.json({ error: 'name and transport.type are required' }, { status: 400 });
    }

    const resourceRoot = await getResourceRoot();
    const existing = await getMcpServerConfig(body.name, resourceRoot);
    if (existing) {
      return NextResponse.json({ error: 'Server already exists' }, { status: 409 });
    }

    const config = await addMcpServerConfig(body, resourceRoot);
    return NextResponse.json({ config }, { status: 201 });
  } catch (error) {
    console.error('[MCP API] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    if (!name) {
      return NextResponse.json({ error: 'name query parameter is required' }, { status: 400 });
    }

    const body = (await request.json()) as Partial<McpServerConfig>;
    const resourceRoot = await getResourceRoot();
    const config = await updateMcpServerConfig(name, body, resourceRoot);

    if (!config) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 });
    }

    return NextResponse.json({ config });
  } catch (error) {
    console.error('[MCP API] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    if (!name) {
      return NextResponse.json({ error: 'name query parameter is required' }, { status: 400 });
    }

    const resourceRoot = await getResourceRoot();
    const deleted = await deleteMcpServerConfig(name, resourceRoot);
    if (!deleted) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[MCP API] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
