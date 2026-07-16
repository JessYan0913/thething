import { readMCPAppResource, type MCPAppResource } from '@the-thing/core';
import { getServerContext, waitForMcpReady } from '@/lib/runtime';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/app-bridge';

// MCP App 资源缓存（内存中，按 URI 缓存）
// 解决 MCP 客户端关闭后无法加载资源的问题
const resourceCache = new Map<string, { resource: MCPAppResource; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

export async function POST(req: Request) {
  try {
    const { uri, action, name, arguments: toolArguments } = await req.json();
    const context = await getServerContext();
    // 等待 MCP 连接就绪，避免在 async connectAll() 完成前访问空 registry
    await waitForMcpReady();
    const registry = context.mcpRegistry;

    if (!registry) {
      return Response.json({ error: 'MCP registry not available' }, { status: 503 });
    }

    if (action === 'read-resource') {
      if (typeof uri !== 'string' || !uri.startsWith('ui://')) {
        return Response.json({ error: 'Invalid resource URI' }, { status: 400 });
      }

      // 检查缓存
      const cached = resourceCache.get(uri);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return Response.json(cached.resource);
      }

      // 从所有连接中找到拥有该 resourceUri 的 client
      for (const [, connection] of registry.connections) {
        if (!connection.client) continue;
        try {
          const resource = await readMCPAppResource({
            client: connection.client as Parameters<typeof readMCPAppResource>[0]['client'],
            uri,
          });
          // 缓存资源
          resourceCache.set(uri, { resource, timestamp: Date.now() });
          return Response.json(resource);
        } catch {
          // 该连接没有这个 resource，继续尝试下一个
        }
      }
      return Response.json({ error: 'MCP App resource not found' }, { status: 404 });
    }

    if (action === 'call-tool') {
      if (typeof name !== 'string' || !name.trim()) {
        return Response.json({ error: 'Invalid tool name' }, { status: 400 });
      }

      // 从所有连接中找到该工具
      for (const [, connection] of registry.connections) {
        if (!connection.client) continue;
        const tools = connection.tools as Record<string, unknown>;
        if (!(name in tools)) continue;
        try {
          const result = await (connection.client as { callTool: (args: { name: string; arguments: Record<string, unknown> }) => Promise<unknown> }).callTool({
            name,
            arguments: toolArguments ?? {},
          });
          return Response.json(result);
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      }
      return Response.json({ error: `Tool "${name}" not found` }, { status: 404 });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('MCP App host error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
