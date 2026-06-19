import { getServerRuntime } from '@/lib/runtime';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function getAllSkillsDirs(): Promise<string[]> {
  const rt = await getServerRuntime();
  return [...rt.layout.resources.skills];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const skillName = searchParams.get('name');
    const filePath = searchParams.get('path');

    if (!skillName || !filePath) {
      return NextResponse.json({ error: 'Missing name or path parameter' }, { status: 400 });
    }

    const allDirs = await getAllSkillsDirs();
    let resolvedPath = '';

    for (const dir of allDirs) {
      const candidate = path.join(dir, skillName, filePath);
      try {
        await fs.access(candidate);
        resolvedPath = candidate;
        break;
      } catch { /* continue */ }
    }

    if (!resolvedPath) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const isWithinSkillsDir = allDirs.some(dir => resolvedPath.startsWith(dir));
    if (!isWithinSkillsDir) {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
    }

    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    const ext = path.extname(resolvedPath).toLowerCase();
    return NextResponse.json({ content, ext });
  } catch (error) {
    console.error('[Skills File API] Error:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
