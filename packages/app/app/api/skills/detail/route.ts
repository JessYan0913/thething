import { getServerRuntime } from '@/lib/runtime';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import type { SkillFileNode } from '@/components/SkillFileTree';

export const runtime = 'nodejs';

async function getAllSkillsDirs(): Promise<string[]> {
  const rt = await getServerRuntime();
  return [...rt.layout.resources.skills];
}

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

/** 递归查找包含 SKILL.md 的子目录，目录名匹配 name */
async function findSkillDirByName(dir: string, name: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === name) {
        // 检查是否包含 SKILL.md
        try {
          await fs.access(path.join(fullPath, 'SKILL.md'));
          return fullPath;
        } catch { /* 继续搜索子目录 */ }
      }
      // 递归进入子目录
      const found = await findSkillDirByName(fullPath, name);
      if (found) return found;
    }
  } catch { /* 目录不可读 */ }
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

    const allDirs = await getAllSkillsDirs();
    let skillDir = '';

    // 先尝试顶层直接匹配
    for (const dir of allDirs) {
      try {
        await fs.access(path.join(dir, skillName));
        skillDir = path.join(dir, skillName);
        break;
      } catch { /* continue */ }
    }

    // 未找到则递归搜索（支持嵌套技能）
    if (!skillDir) {
      for (const dir of allDirs) {
        const found = await findSkillDirByName(dir, skillName);
        if (found) {
          skillDir = found;
          break;
        }
      }
    }

    if (!skillDir) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    const tree = await buildTree(skillDir, skillDir);
    const skillMdPath = await findSkillMd(skillDir);
    const relativeSkillMdPath = skillMdPath ? path.relative(skillDir, skillMdPath) : null;

    return NextResponse.json({ tree, skillMdPath: relativeSkillMdPath });
  } catch (error) {
    console.error('[Skills Detail API] Error:', error);
    return NextResponse.json({ error: 'Failed to load skill detail' }, { status: 500 });
  }
}
