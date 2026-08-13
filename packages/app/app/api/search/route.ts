import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/search?q=<query>&source=&sourceId=&projectId=&limit=
 * 全会话全文检索（基于 message_text 镜像表，不扫 messages.content 巨列）。
 * 默认全局搜索；source/sourceId/projectId 为可选过滤（预留，当前弹窗不用）。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') ?? '').trim();
    if (!q) {
      return NextResponse.json({ results: [] });
    }
    const source = searchParams.get('source') || undefined;
    const sourceId = searchParams.get('sourceId') || undefined;
    const projectId = searchParams.get('projectId') || undefined;
    const parsedLimit = Number(searchParams.get('limit') ?? 20);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 20;

    const rt = await getServerRuntime();
    const results = rt.dataStore.messageStore.searchMessages(q, {
      source,
      sourceId,
      projectId,
      limit,
    });
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[Search API] GET error:', error);
    return NextResponse.json({ error: 'Failed to search conversations' }, { status: 500 });
  }
}
