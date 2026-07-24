import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { resolveSkillByFolderName, synthesizeSkillMd } from '@/lib/skills';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const skillName = searchParams.get('name');
    const filePath = searchParams.get('path');

    if (!skillName || !filePath) {
      return NextResponse.json({ error: 'Missing name or path parameter' }, { status: 400 });
    }

    const resolved = await resolveSkillByFolderName(skillName);
    if (!resolved) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    // 内联 bundled skill：合成虚拟 SKILL.md
    if (!resolved.dir) {
      if (filePath !== 'SKILL.md') {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      return NextResponse.json({ content: synthesizeSkillMd(resolved.skill), ext: '.md' });
    }

    const resolvedPath = path.resolve(resolved.dir, filePath);
    if (!resolvedPath.startsWith(resolved.dir + path.sep)) {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
    }

    let stat;
    try {
      stat = await fs.stat(resolvedPath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
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
