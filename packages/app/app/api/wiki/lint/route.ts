import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';
import { lintWiki, migrateWikiToDirectories, rebuildSourcePageIndex } from '@the-thing/core';

export const runtime = 'nodejs';

// POST /api/wiki/lint → 先迁移平铺文件到 category/ 子目录，再运行确定性健康检查
export async function POST() {
  try {
    const rt = await getServerRuntime();
    const wikiDir = rt.layout.resources.wiki[0];
    if (!wikiDir) {
      return NextResponse.json({ error: 'Wiki directory not configured' }, { status: 500 });
    }

    // 一次性的存储迁移：将根目录平铺 .md 移入 category/ 子目录。
    // 迁移会重建 index.md；source-pages.json 记录的旧 filename 也随之失效，需一并重建。
    const migrated = await migrateWikiToDirectories(wikiDir);
    if (migrated.length > 0) {
      await rebuildSourcePageIndex(wikiDir);
    }

    const report = await lintWiki(wikiDir);
    return NextResponse.json({ report, migrated });
  } catch (error) {
    console.error('[Wiki Lint API] POST error:', error);
    return NextResponse.json({ error: 'Failed to lint wiki' }, { status: 500 });
  }
}
