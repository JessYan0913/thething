import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';
import {
  readAllPages,
  writePage,
  updatePage,
  deletePage,
  rebuildIndex,
  getUserWikiDir,
  ensureWikiDirExists,
  pageNameToFilename,
  type WikiPageData,
} from '@the-thing/core';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const rt = await getServerRuntime();
    const memoryDir = rt.layout.resources.memory[0];

    if (!memoryDir) {
      return NextResponse.json({ pages: [] });
    }

    const wikiDir = getUserWikiDir('default', memoryDir);
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
      lines: p.content.split('\n').length,
      sizeKb: Buffer.byteLength(p.content, 'utf-8') / 1024,
    }));

    return NextResponse.json({ pages: view });
  } catch (error) {
    console.error('[Wiki API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load wiki pages' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, category, content } = body;

    if (!name || !category || !content) {
      return NextResponse.json({ error: 'Missing required fields: name, category, content' }, { status: 400 });
    }

    const rt = await getServerRuntime();
    const memoryDir = rt.layout.resources.memory[0];
    if (!memoryDir) {
      return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }

    const wikiDir = getUserWikiDir('default', memoryDir);
    await ensureWikiDirExists(wikiDir);

    const now = new Date().toISOString();
    const data: WikiPageData = {
      name,
      description: description || '',
      category,
      created: now,
      updated: now,
    };

    const filename = await writePage(wikiDir, data, content);
    await rebuildIndex(wikiDir);

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

    if (!filename || !name || !category || content === undefined) {
      return NextResponse.json({ error: 'Missing required fields: filename, name, category, content' }, { status: 400 });
    }

    const rt = await getServerRuntime();
    const memoryDir = rt.layout.resources.memory[0];
    if (!memoryDir) {
      return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }

    const wikiDir = getUserWikiDir('default', memoryDir);

    // If name or category changed, use replacePage; otherwise updatePage
    const normalizedName = pageNameToFilename(name).replace('.md', '');
    const oldName = filename.replace('.md', '');

    if (normalizedName !== oldName || category) {
      const { replacePage } = await import('@the-thing/core');
      const now = new Date().toISOString();
      const data: WikiPageData = {
        name,
        description: description || '',
        category,
        created: now,
        updated: now,
      };
      await replacePage(wikiDir, filename, data, content);
    } else {
      await updatePage(wikiDir, filename, content, 'replace');
    }

    await rebuildIndex(wikiDir);

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

    const rt = await getServerRuntime();
    const memoryDir = rt.layout.resources.memory[0];
    if (!memoryDir) {
      return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }

    const wikiDir = getUserWikiDir('default', memoryDir);
    await deletePage(wikiDir, filename);
    await rebuildIndex(wikiDir);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Wiki API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete wiki page' }, { status: 500 });
  }
}
