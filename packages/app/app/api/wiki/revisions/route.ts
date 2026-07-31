import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';
import {
  listPageRevisions,
  readPageRevision,
  diffPageRevisions,
  restorePageRevision,
  rebuildIndex,
  rebuildSourcePageIndex,
  withWikiMutationLock,
  initializeWikiRevisionBaselines,
  appendLog,
} from '@the-thing/core';

export const runtime = 'nodejs';

async function getWikiDir(): Promise<string | null> {
  const rt = await getServerRuntime();
  return rt.layout.resources.wiki[0] ?? null;
}

// GET /api/wiki/revisions?filename=x.md                       → revision 列表
// GET /api/wiki/revisions?filename=x.md&revisionId=...        → 单个 revision 快照
// GET /api/wiki/revisions?filename=x.md&from=...&to=...       → diff（from/to 省略表示当前版本）
export async function GET(request: Request) {
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

    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (from || to) {
      const diff = await diffPageRevisions(wikiDir, {
        filename,
        fromRevisionId: from ?? undefined,
        toRevisionId: to ?? undefined,
      });
      return NextResponse.json({ diff });
    }

    const revisionId = searchParams.get('revisionId');
    if (revisionId) {
      const snapshot = await readPageRevision(wikiDir, filename, revisionId);
      if (!snapshot) {
        return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
      }
      return NextResponse.json({ revision: snapshot.record, raw: snapshot.raw });
    }

    const revisions = await listPageRevisions(wikiDir, filename);
    return NextResponse.json({ revisions });
  } catch (error) {
    console.error('[Wiki Revisions API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load wiki revisions' }, { status: 500 });
  }
}

// POST /api/wiki/revisions  body: { filename, revisionId, reason? } → 显式恢复
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { filename, revisionId, reason } = body;
    if (!filename || !revisionId) {
      return NextResponse.json({ error: 'Missing required fields: filename, revisionId' }, { status: 400 });
    }

    const wikiDir = await getWikiDir();
    if (!wikiDir) {
      return NextResponse.json({ error: 'Wiki directory not configured' }, { status: 500 });
    }

    const revision = await withWikiMutationLock(wikiDir, async () => {
      await initializeWikiRevisionBaselines(wikiDir);
      const restored = await restorePageRevision(wikiDir, { filename, revisionId, reason });
      await rebuildIndex(wikiDir);
      await rebuildSourcePageIndex(wikiDir);
      await appendLog(wikiDir, {
        timestamp: restored.createdAt,
        operation: 'manual',
        description: `用户恢复页面 ${restored.filename}`,
        details: [
          `restore: [[${restored.pageName ?? restored.filename}]] → ${restored.restoredFromRevisionId}`,
          ...(reason ? [`reason: ${reason}`] : []),
        ],
      });
      return restored;
    });

    return NextResponse.json({
      success: true,
      revisionId: revision.id,
      restoredFromRevisionId: revision.restoredFromRevisionId,
    });
  } catch (error) {
    console.error('[Wiki Revisions API] POST error:', error);
    return NextResponse.json({ error: 'Failed to restore wiki revision' }, { status: 500 });
  }
}
