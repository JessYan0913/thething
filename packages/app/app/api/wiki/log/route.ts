import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

interface WikiLogEntry {
  timestamp: string;
  operation: string;
  description: string;
  details: string[];
}

// log.md 条目格式：## [timestamp] operation | description，后跟 - detail 行
function parseLog(content: string): WikiLogEntry[] {
  const entries: WikiLogEntry[] = [];
  let current: WikiLogEntry | null = null;

  for (const line of content.split('\n')) {
    const header = line.match(/^## \[(.+?)\] (\S+) \| (.+)$/);
    if (header) {
      current = { timestamp: header[1], operation: header[2], description: header[3], details: [] };
      entries.push(current);
      continue;
    }
    const detail = line.match(/^- (.+)$/);
    if (detail && current) {
      current.details.push(detail[1]);
    }
  }
  return entries;
}

// GET /api/wiki/log?limit=50 → 最近的操作日志（新到旧）
export async function GET(request: Request) {
  try {
    const rt = await getServerRuntime();
    const wikiDir = rt.layout.resources.wiki[0];
    if (!wikiDir) {
      return NextResponse.json({ entries: [] });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

    let content = '';
    try {
      content = await fs.readFile(path.join(wikiDir, 'log.md'), 'utf-8');
    } catch {
      return NextResponse.json({ entries: [] });
    }

    const entries = parseLog(content).reverse().slice(0, limit);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[Wiki Log API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load wiki log' }, { status: 500 });
  }
}
