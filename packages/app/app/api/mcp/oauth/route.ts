import { NextRequest, NextResponse } from 'next/server';
import { loadAgentContext } from '@/lib/agent-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/mcp/oauth?name=X
 *
 * 登出 / 重新授权：清除该服务器的 OAuth token 并断开连接，
 * 状态回到「需要授权」。由设置页「重新授权 / 断开授权」菜单调用。
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    if (!name) {
      return NextResponse.json({ error: 'name 必填' }, { status: 400 });
    }

    const context = await loadAgentContext();
    const mcpRegistry = context.mcpRegistry;
    if (!mcpRegistry) {
      return NextResponse.json({ error: 'MCP Registry 不可用' }, { status: 503 });
    }

    const result = await mcpRegistry.resetOAuth(name);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? '重置授权失败' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[MCP OAuth Reset]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
