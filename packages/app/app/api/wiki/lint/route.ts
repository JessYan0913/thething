import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';
import { lintWiki } from '@the-thing/core';

export const runtime = 'nodejs';

// POST /api/wiki/lint → 运行确定性健康检查（索引同步、一致性自动修复；语义检查需 LLM，由 Agent 工具执行）
export async function POST() {
  try {
    const rt = await getServerRuntime();
    const wikiDir = rt.layout.resources.wiki[0];
    if (!wikiDir) {
      return NextResponse.json({ error: 'Wiki directory not configured' }, { status: 500 });
    }

    const report = await lintWiki(wikiDir);
    return NextResponse.json({ report });
  } catch (error) {
    console.error('[Wiki Lint API] POST error:', error);
    return NextResponse.json({ error: 'Failed to lint wiki' }, { status: 500 });
  }
}
