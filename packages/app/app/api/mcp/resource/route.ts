import { NextRequest, NextResponse } from 'next/server';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { loadAgentContext } from '@/lib/agent-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mcp/resource
 *
 * 获取 MCP App 的 HTML 资源
 *
 * Body: {
 *   serverName: string,
 *   resourceUri: string
 * }
 *
 * Response: {
 *   html: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serverName, resourceUri } = body;

    if (!serverName || !resourceUri) {
      return NextResponse.json(
        { error: 'Missing serverName or resourceUri' },
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

    // 读取资源
    const result = await client.readResource({ uri: resourceUri });

    // 提取 HTML 内容
    const htmlContent = result.contents.find((c: any) =>
      c.mimeType?.includes('html') || c.mimeType === 'text/html;profile=mcp-app'
    );

    if (!htmlContent || !htmlContent.text) {
      return NextResponse.json(
        { error: 'No HTML content found in resource' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      html: htmlContent.text,
    });

  } catch (error) {
    console.error('[MCP Resource API]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
