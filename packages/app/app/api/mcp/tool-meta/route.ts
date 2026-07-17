import { NextRequest, NextResponse } from 'next/server';
import { loadAgentContext } from '@/lib/agent-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mcp/tool-meta?name=toolName&server=serverName
 *
 * 获取 MCP 工具的元数据（包括 _meta.ui）
 *
 * Query: {
 *   name: string,    // 工具基础名称（不含 mcp__ 前缀）
 *   server: string   // MCP 服务器名称
 * }
 *
 * Response: {
 *   _meta?: {
 *     ui?: {
 *       resourceUri: string,
 *       entityType?: string,
 *       visibility?: 'model-and-app' | 'app-only' | 'model-only'
 *     }
 *   }
 * }
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

    // 从 AgentContext 获取 MCP Registry
    const context = await loadAgentContext();
    const mcpRegistry = context.mcpRegistry;

    if (!mcpRegistry) {
      return NextResponse.json(
        { error: 'MCP Registry not available' },
        { status: 503 }
      );
    }

    // 获取连接
    const connection = mcpRegistry.connections.get(serverName);
    if (!connection || connection.error || !connection.tools) {
      return NextResponse.json(
        { error: `MCP server "${serverName}" not connected or has no tools` },
        { status: 404 }
      );
    }

    // 从连接中获取工具定义
    const tool = connection.tools[toolName];
    if (!tool) {
      return NextResponse.json(
        { error: `Tool "${toolName}" not found on server "${serverName}"` },
        { status: 404 }
      );
    }

    // 提取 _meta 字段（如果存在）
    const toolWithMeta = tool as any;
    const meta = toolWithMeta._meta || {};

    return NextResponse.json({
      _meta: meta,
    });

  } catch (error) {
    console.error('[MCP Tool Meta API]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
