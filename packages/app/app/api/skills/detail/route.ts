import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import type { SkillFileNode } from '@/components/SkillFileTree';
import { resolveSkillByFolderName } from '@/lib/skills';

export const runtime = 'nodejs';

async function findSkillMd(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const result = await findSkillMd(fullPath);
        if (result) return result;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function buildTree(dir: string, basePath: string): Promise<SkillFileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: SkillFileNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children: await buildTree(fullPath, basePath),
      });
    } else {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const skillName = searchParams.get('name');

    if (!skillName) {
      return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
    }

    const resolved = await resolveSkillByFolderName(skillName);
    if (!resolved) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    // 内联 bundled skill 无磁盘目录，返回虚拟的 SKILL.md 节点
    if (!resolved.dir) {
      const tree: SkillFileNode[] = [
        { name: 'SKILL.md', path: 'SKILL.md', type: 'file' },
      ];
      return NextResponse.json({ tree, skillMdPath: 'SKILL.md' });
    }

    const tree = await buildTree(resolved.dir, resolved.dir);
    const skillMdPath = await findSkillMd(resolved.dir);
    const relativeSkillMdPath = skillMdPath ? path.relative(resolved.dir, skillMdPath) : null;

    return NextResponse.json({ tree, skillMdPath: relativeSkillMdPath });
  } catch (error) {
    console.error('[Skills Detail API] Error:', error);
    return NextResponse.json({ error: 'Failed to load skill detail' }, { status: 500 });
  }
}
