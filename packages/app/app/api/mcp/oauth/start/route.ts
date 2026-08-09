import { NextRequest, NextResponse } from 'next/server';
import { loadAgentContext } from '@/lib/agent-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mcp/oauth/start
 *
 * 发起 OAuth 授权：清除旧 token → force 重连触发 SDK 授权流程 →
 * 返回浏览器授权 URL（前端打开它）。
 *
 * Body: { name: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === 'string' && body.name ? body.name : '';
    if (!name) {
      return NextResponse.json({ error: 'name 必填' }, { status: 400 });
    }

    const context = await loadAgentContext();
    const mcpRegistry = context.mcpRegistry;
    if (!mcpRegistry) {
      return NextResponse.json({ error: 'MCP Registry 不可用' }, { status: 503 });
    }

    const result = await mcpRegistry.startOAuth(name);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? '发起授权失败' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      authorizationUrl: result.authorizationUrl ?? null,
    });
  } catch (error) {
    console.error('[MCP OAuth Start]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
