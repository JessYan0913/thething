import { NextRequest, NextResponse } from 'next/server';
import { isToolVisibilityModelOnly } from '@modelcontextprotocol/ext-apps/app-bridge';
import { loadAgentContext } from '@/lib/agent-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mcp/proxy?server=serverName
 *
 * 代理 MCP App 内的请求（tools/call、tools/list）
 *
 * Query: {
 *   server: string  // MCP 服务器名称
 * }
 *
 * Body: {
 *   jsonrpc: '2.0',
 *   method: 'tools/call' | 'tools/list',
 *   params: { name?: string, arguments?: Record<string, unknown> }
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
    const { method, params } = body;

    // 从 AgentContext 获取 MCP Registry
    const context = await loadAgentContext();
    const mcpRegistry = context.mcpRegistry;

    if (!mcpRegistry) {
      return NextResponse.json(
        { error: 'MCP Registry not available' },
        { status: 503 }
      );
    }

    // 获取服务器配置
    const serverConfig = mcpRegistry.servers.find((s: { name: string }) => s.name === serverName);
    if (!serverConfig) {
      return NextResponse.json(
        { error: `MCP server "${serverName}" not found` },
        { status: 404 }
      );
    }

    const serverTools = mcpRegistry.getServerTools(serverName) as Record<string, Record<string, unknown>>;

    // tools/list：只返回 App 可见的工具（规范：App 不应看到 model-only 工具）
    if (method === 'tools/list') {
      const tools = Object.entries(serverTools)
        .filter(([, tool]) => !isToolVisibilityModelOnly(tool))
        .map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: (tool.inputSchema as object) ?? { type: 'object', properties: {} },
          ...(tool._meta ? { _meta: tool._meta } : {}),
        }));
      return NextResponse.json({ jsonrpc: '2.0', result: { tools } });
    }

    if (method !== 'tools/call' || !params?.name) {
      return NextResponse.json(
        { error: 'Unsupported method or missing tool name' },
        { status: 400 }
      );
    }

    // visibility 校验（规范 MUST）：App 只能调用 visibility 含 "app" 的工具。
    // 未声明 visibility 默认 model+app 可见；model-only 的工具必须拒绝
    const tool = serverTools[params.name];
    if (!tool) {
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32602, message: `Tool "${params.name}" not found on server "${serverName}"` } },
        { status: 404 }
      );
    }
    if (isToolVisibilityModelOnly(tool)) {
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32602, message: `Tool "${params.name}" is not callable from apps (visibility: model-only)` } },
        { status: 403 }
      );
    }

    // 调用工具（callToolSafe 内含超时 + 一次自动重连重试，治僵尸连接的 -32001）
    const result = await mcpRegistry.callToolSafe(
      serverName,
      params.name,
      params.arguments || {},
    );

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
