import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/runtime';

/**
 * GET /api/mcp/tool-meta
 *
 * 获取 MCP 工具的元数据，包括 _meta.ui 信息（用于 MCP App 渲染检测）
 *
 * Query params:
 * - name: 工具名称（base name，不含前缀）
 * - server: MCP 服务器名称
 *
 * Response:
 * - { _meta: {...} | null }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const toolName = searchParams.get('name');
    const serverName = searchParams.get('server');

    if (!toolName || !serverName) {
      return NextResponse.json(
        { error: 'Missing name or server parameter' },
        { status: 400 }
      );
    }

    const context = await getServerContext();
    const registry = context.mcpRegistry;

    if (!registry) {
      return NextResponse.json(
        { _meta: null },
        { status: 404 }
      );
    }

    const connection = registry.connections.get(serverName);

    if (!connection || !connection.client) {
      return NextResponse.json(
        { _meta: null },
        { status: 404 }
      );
    }

    // 从 MCP 客户端获取工具列表
    const tools = await connection.client.tools();

    // 查找匹配的工具（可能有 mcp__ 前缀）
    const toolKey = Object.keys(tools).find(
      (key) => key === toolName || key === `mcp__${serverName}__${toolName}`
    );

    if (!toolKey) {
      return NextResponse.json(
        { _meta: null },
        { status: 404 }
      );
    }

    const tool = tools[toolKey] as unknown as { _meta?: Record<string, unknown> };

    return NextResponse.json({
      _meta: tool._meta || null,
    });
  } catch (error) {
    console.error('[API] /api/mcp/tool-meta error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
