import { getServerRuntime, getServerContext, getServerContextIfReady } from '@/lib/runtime';
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

async function getRuntimeLayout(): Promise<{ resourceRoot: string; configDir: string }> {
  const rt = await getServerRuntime();
  return {
    resourceRoot: rt.layout.resourceRoot,
    configDir: rt.layout.configDir,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const connect = searchParams.get('connect') === 'true';

    if (name) {
      const { resourceRoot, configDir } = await getRuntimeLayout();
      const config = await getMcpServerConfig(name, resourceRoot, configDir);
      if (!config) {
        return NextResponse.json({ error: 'Server not found' }, { status: 404 });
      }

      if (connect) {
        // 优先查共享 registry 的实时状态（已在启动时连接）
        const context = getServerContextIfReady() ?? await getServerContext();
        if (context.mcpRegistry) {
          const snap = context.mcpRegistry.snapshot();
          const serverSnap = snap.servers.find(s => s.name === name);
          if (serverSnap) {
            return NextResponse.json({ config, snapshot: { servers: [serverSnap], totalTools: snap.totalTools } });
          }
        }

        // 不在共享 registry 中（如新建的服务器），创建临时连接测试
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

    // 列表视图：从磁盘读取配置，不依赖运行时初始化
    const configs = await getMcpServerConfigs(process.cwd());
    // Try to get snapshot without forcing runtime init
    const snapshot = getServerContextIfReady()?.mcpRegistry?.snapshot() ?? null;

    return NextResponse.json({ servers: configs, snapshot });
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

    const { resourceRoot, configDir } = await getRuntimeLayout();
    const existing = await getMcpServerConfig(body.name, resourceRoot, configDir);
    if (existing) {
      return NextResponse.json({ error: 'Server already exists' }, { status: 409 });
    }

    const config = await addMcpServerConfig(body, resourceRoot, configDir);
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
    const { resourceRoot, configDir } = await getRuntimeLayout();
    const config = await updateMcpServerConfig(name, body, resourceRoot, configDir);

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

    const { resourceRoot, configDir } = await getRuntimeLayout();
    const deleted = await deleteMcpServerConfig(name, resourceRoot, configDir);
    if (!deleted) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[MCP API] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
