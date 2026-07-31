import { getServerRuntime } from '@/lib/runtime';
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
  capturePageRevision,
  initializeWikiRevisionBaselines,
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

    return NextResponse.json({ pages: view });
  } catch (error) {
    console.error('[Wiki API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load wiki pages' }, { status: 500 });
  }
}

// UI 写入与 Agent 工具共享同一受管路径：mutation lock + revision + index + log。
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
      await initializeWikiRevisionBaselines(wikiDir);

      const now = new Date().toISOString();
      const data: WikiPageData = {
        name,
        description: description || '',
        category: category || DEFAULT_WIKI_CATEGORY,
        created: now,
        updated: now,
      };

      const written = await writePage(wikiDir, data, content);
      await capturePageRevision(wikiDir, { filename: written, operation: 'create', reason: '用户在界面创建' });
      await rebuildIndex(wikiDir);
      await appendLog(wikiDir, {
        timestamp: now,
        operation: 'manual',
        description: `用户创建页面 ${written}`,
        details: [`create: [[${name}]] — ${description || ''}`],
      });
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
      await initializeWikiRevisionBaselines(wikiDir);

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
        await capturePageRevision(wikiDir, { filename, operation: 'replace', reason: '用户在界面编辑' });
      } else {
        await updatePage(wikiDir, filename, content, 'replace');
        await capturePageRevision(wikiDir, { filename, operation: 'update', reason: '用户在界面编辑' });
      }

      await rebuildIndex(wikiDir);
      await rebuildSourcePageIndex(wikiDir);
      await appendLog(wikiDir, {
        timestamp: now,
        operation: 'manual',
        description: `用户编辑页面 ${filename}`,
        details: [`update: [[${name}]]`],
      });
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
      await initializeWikiRevisionBaselines(wikiDir);
      // 删除前保存最后一版快照，历史仍可追溯
      await capturePageRevision(wikiDir, { filename, operation: 'delete', reason: '用户在界面删除' });
      await deletePage(wikiDir, filename);
      await rebuildIndex(wikiDir);
      await rebuildSourcePageIndex(wikiDir);
      await appendLog(wikiDir, {
        timestamp: new Date().toISOString(),
        operation: 'manual',
        description: `用户删除页面 ${filename}`,
        details: [`delete: ${filename}`],
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Wiki API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete wiki page' }, { status: 500 });
  }
}
