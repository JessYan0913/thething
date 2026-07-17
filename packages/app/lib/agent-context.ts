import { getServerContext, waitForMcpReady } from '@/lib/runtime';

/**
 * MCP API 路由共用：获取 AppContext 并等待 MCP 连接就绪，
 * 保证 mcpRegistry 的 servers/connections 状态可用。
 */
export async function loadAgentContext() {
  const context = await getServerContext();
  await waitForMcpReady();
  return context;
}
