import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/runtime';

/**
 * GET /api/mcp/servers
 *
 * 返回所有 MCP 服务器的名称到 URL 的映射
 * 用于 McpWidget 组件获取 serverUrl
 *
 * Response:
 * - { [serverName]: url }
 */
export async function GET() {
  try {
    const context = await getServerContext();
    const registry = context.mcpRegistry;

    if (!registry) {
      return NextResponse.json({});
    }

    const serverUrls: Record<string, string> = {};

    for (const [name, connection] of registry.connections) {
      const transport = connection.config.transport;

      // 仅 HTTP/SSE 类型有 URL
      if (transport.type === 'http' || transport.type === 'sse' || transport.type === 'streamable-http') {
        serverUrls[name] = transport.url;
      }
      // stdio 类型没有 URL，不添加
    }

    return NextResponse.json(serverUrls);
  } catch (error) {
    console.error('[API] /api/mcp/servers error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
