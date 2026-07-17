import { NextRequest, NextResponse } from 'next/server';
import { loadAgentContext } from '@/lib/agent-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mcp/proxy?server=serverName
 *
 * 代理 MCP App 内的工具调用
 *
 * Query: {
 *   server: string  // MCP 服务器名称
 * }
 *
 * Body: {
 *   jsonrpc: '2.0',
 *   method: 'tools/call',
 *   params: {
 *     name: string,
 *     arguments: Record<string, unknown>
 *   }
 * }
 *
 * Response: JSON-RPC result
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serverName = searchParams.get('server');

    if (!serverName) {
      return NextResponse.json(
        { error: 'Missing server parameter' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { params } = body;

    if (!params || !params.name) {
      return NextResponse.json(
        { error: 'Missing tool name in params' },
        { status: 400 }
      );
    }

    // 从 AgentContext 获取 MCP Registry
    const context = await loadAgentContext();
    const mcpRegistry = context.mcpRegistry;

    if (!mcpRegistry) {
      return NextResponse.json(
        { error: 'MCP Registry not available' },
        { status: 503 }
      );
    }

    // 获取服务器配置和连接
    const serverConfig = mcpRegistry.servers.find(s => s.name === serverName);
    if (!serverConfig) {
      return NextResponse.json(
        { error: `MCP server "${serverName}" not found` },
        { status: 404 }
      );
    }

    let connection = mcpRegistry.connections.get(serverName);

    // 如果没有连接，尝试连接
    if (!connection || connection.error) {
      connection = await mcpRegistry.connect(serverConfig);
      if (connection.error) {
        return NextResponse.json(
          { error: `Failed to connect to MCP server: ${connection.error.message}` },
          { status: 500 }
        );
      }
    }

    const client = connection.client;
    if (!client) {
      return NextResponse.json(
        { error: 'MCP client not available' },
        { status: 500 }
      );
    }

    // 调用工具
    const result = await client.callTool({
      name: params.name,
      arguments: params.arguments || {},
    });

    // 返回 JSON-RPC 格式的结果
    return NextResponse.json({
      jsonrpc: '2.0',
      result: result,
    });

  } catch (error) {
    console.error('[MCP Proxy API]', error);
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      },
      { status: 500 }
    );
  }
}
