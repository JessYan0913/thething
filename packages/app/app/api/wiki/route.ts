import { getServerRuntime } from '@/lib/runtime';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import {
  readAllPages,
  writePage,
  updatePage,
  replacePage,
  deletePage,
  rebuildIndex,
  rebuildSourcePageIndex,
  ensureWikiDirExists,
  pageNameToFilename,
  DEFAULT_WIKI_CATEGORY,
  withWikiMutationLock,
  commitWiki,
  ensureWikiGitRepo,
  appendLog,
  type WikiPageData,
} from '@the-thing/core';

export const runtime = 'nodejs';

async function getWikiDir(): Promise<string | null> {
  const rt = await getServerRuntime();
  return rt.layout.resources.wiki[0] ?? null;
}

export async function GET() {
  try {
    const wikiDir = await getWikiDir();
    if (!wikiDir) {
      return NextResponse.json({ pages: [] });
    }

    await ensureWikiDirExists(wikiDir);

    const pages = await readAllPages(wikiDir);

    // 统计待迁移的平铺文件（根目录下直接放置的 .md，未归入 category/ 子目录）
    let pendingMigration = 0;
    try {
      const rootEntries = await fs.readdir(wikiDir, { withFileTypes: true });
      pendingMigration = rootEntries.filter(
        (e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md' && e.name !== 'log.md',
      ).length;
    } catch {
      // 目录可能不存在，忽略
    }

    const view = pages.map((p) => ({
      name: p.data.name,
      description: p.data.description,
      category: p.data.category,
      content: p.content,
      filename: p.filename,
      created: p.data.created,
      updated: p.data.updated,
      origin: p.data.origin,
      sources: p.data.sources ?? [],
      lines: p.content.split('\n').length,
      sizeKb: Buffer.byteLength(p.content, 'utf-8') / 1024,
    }));

    return NextResponse.json({ pages: view, pendingMigration });
  } catch (error) {
    console.error('[Wiki API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load wiki pages' }, { status: 500 });
  }
}

// UI 写入与 Agent 工具共享同一受管路径：mutation lock + index + log + git commit。
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, category, content } = body;

    if (!name || !content) {
      return NextResponse.json({ error: 'Missing required fields: name, content' }, { status: 400 });
    }

    const wikiDir = await getWikiDir();
    if (!wikiDir) {
      return NextResponse.json({ error: 'Wiki directory not configured' }, { status: 500 });
    }

    const filename = await withWikiMutationLock(wikiDir, async () => {
      await ensureWikiDirExists(wikiDir);
      await ensureWikiGitRepo(wikiDir);

      const now = new Date().toISOString();
      const data: WikiPageData = {
        name,
        description: description || '',
        category: category || DEFAULT_WIKI_CATEGORY,
        created: now,
        updated: now,
      };

      const written = await writePage(wikiDir, data, content);
      await rebuildIndex(wikiDir);
      await appendLog(wikiDir, {
        timestamp: now,
        operation: 'manual',
        description: `用户创建页面 ${written}`,
        details: [`create: [[${name}]] — ${description || ''}`],
      });
      await commitWiki(wikiDir, `manual: 创建 ${written}`);
      return written;
    });

    return NextResponse.json({ success: true, filename });
  } catch (error) {
    console.error('[Wiki API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create wiki page' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { filename, name, description, category, content } = body;

    if (!filename || !name || content === undefined) {
      return NextResponse.json({ error: 'Missing required fields: filename, name, content' }, { status: 400 });
    }

    const wikiDir = await getWikiDir();
    if (!wikiDir) {
      return NextResponse.json({ error: 'Wiki directory not configured' }, { status: 500 });
    }

    await withWikiMutationLock(wikiDir, async () => {
      await ensureWikiGitRepo(wikiDir);
      // If name or category changed, use replacePage; otherwise updatePage
      const normalizedName = pageNameToFilename(name).replace('.md', '');
      const oldName = filename.replace('.md', '');

      const now = new Date().toISOString();
      if (normalizedName !== oldName || category) {
        const data: WikiPageData = {
          name,
          description: description || '',
          category: category || DEFAULT_WIKI_CATEGORY,
          created: now, // replacePage 内部保留已有 created
          updated: now,
        };
        await replacePage(wikiDir, filename, data, content);
      } else {
        await updatePage(wikiDir, filename, content, 'replace');
      }

      await rebuildIndex(wikiDir);
      await rebuildSourcePageIndex(wikiDir);
      await appendLog(wikiDir, {
        timestamp: now,
        operation: 'manual',
        description: `用户编辑页面 ${filename}`,
        details: [`update: [[${name}]]`],
      });
      await commitWiki(wikiDir, `manual: 编辑 ${filename}`);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Wiki API] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update wiki page' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('filename');
    if (!filename) {
      return NextResponse.json({ error: 'Missing filename query parameter' }, { status: 400 });
    }

    const wikiDir = await getWikiDir();
    if (!wikiDir) {
      return NextResponse.json({ error: 'Wiki directory not configured' }, { status: 500 });
    }

    await withWikiMutationLock(wikiDir, async () => {
      await ensureWikiGitRepo(wikiDir);
      await deletePage(wikiDir, filename);
      await rebuildIndex(wikiDir);
      await rebuildSourcePageIndex(wikiDir);
      await appendLog(wikiDir, {
        timestamp: new Date().toISOString(),
        operation: 'manual',
        description: `用户删除页面 ${filename}`,
        details: [`delete: ${filename}`],
      });
      await commitWiki(wikiDir, `manual: 删除 ${filename}`);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Wiki API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete wiki page' }, { status: 500 });
  }
}
