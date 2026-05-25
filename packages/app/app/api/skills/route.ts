import { getServerContext, getServerRuntime, reloadServerContext } from '@/lib/runtime';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function getPrimarySkillsDir(): Promise<string> {
  const rt = await getServerRuntime();
  const dirs = rt.layout.resources.skills;
  return dirs[dirs.length - 1];
}

async function ensureSkillsDir(): Promise<string> {
  const dir = await getPrimarySkillsDir();
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  return dir;
}

function parseSkillMd(content: string): { name: string; description: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    const nameMatch = content.match(/^#\s+(.+)/m);
    return { name: nameMatch?.[1]?.trim() || '', description: '' };
  }

  const frontmatter = match[1];
  const metadata: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      metadata[line.slice(0, colonIndex).trim()] = line.slice(colonIndex + 1).trim();
    }
  }

  return { name: metadata.name || '', description: metadata.description || '' };
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

interface SkillFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillFileNode[];
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

// GET / — list all skills
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    if (name === 'detail') {
      // GET /skills/detail?name=xxx
      const skillName = searchParams.get('name');
      if (!skillName) {
        return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
      }
    }

    if (name === 'file') {
      // GET /skills/file?name=xxx&path=xxx
      const skillName = searchParams.get('name');
      const filePath = searchParams.get('path');
      if (!skillName || !filePath) {
        return NextResponse.json({ error: 'Missing name or path parameter' }, { status: 400 });
      }

      const skillsDir = await getPrimarySkillsDir();
      const resolvedPath = path.join(skillsDir, skillName, filePath);

      if (!resolvedPath.startsWith(skillsDir)) {
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
      }

      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) {
        return NextResponse.json({ error: 'Not a file' }, { status: 400 });
      }

      const content = await fs.readFile(resolvedPath, 'utf-8');
      const ext = path.extname(resolvedPath).toLowerCase();
      return NextResponse.json({ content, ext });
    }

    const context = await getServerContext();
    const skills = context.skills.map((skill) => {
      const sourceDir = path.dirname(skill.sourcePath);
      return {
        name: skill.name,
        folderName: path.basename(sourceDir),
        description: skill.description,
        whenToUse: skill.whenToUse,
        allowedTools: skill.allowedTools,
        model: skill.model,
        effort: skill.effort,
        context: skill.context,
        paths: skill.paths,
        sourcePath: skill.sourcePath,
        source: skill.source ?? 'project',
      };
    });

    return NextResponse.json({ skills });
  } catch (error) {
    console.error('[Skills API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load skills' }, { status: 500 });
  }
}

// POST / — create skill (upload or create from content)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'upload') {
      // Simplified upload - in production would handle multipart
      const { folderName, files } = body;
      if (!folderName) {
        return NextResponse.json({ error: 'Missing folderName' }, { status: 400 });
      }

      const skillsDir = await ensureSkillsDir();
      const folderPath = path.join(skillsDir, folderName);

      try {
        const stat = await fs.stat(folderPath);
        if (stat.isDirectory() && !body.overwrite) {
          return NextResponse.json({ error: 'Skill already exists' }, { status: 409 });
        }
      } catch {
        // Directory doesn't exist, proceed
      }

      await fs.mkdir(folderPath, { recursive: true });

      if (files && typeof files === 'object') {
        for (const [relativePath, content] of Object.entries(files)) {
          if (typeof content !== 'string') continue;
          const filePath = path.join(folderPath, relativePath);
          const fileDir = path.dirname(filePath);
          await fs.mkdir(fileDir, { recursive: true });
          await fs.writeFile(filePath, content, 'utf-8');
        }
      }

      await reloadServerContext();
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[Skills API] POST error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

// DELETE / — delete skill
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    if (!name) {
      return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
    }

    const skillsDir = await getPrimarySkillsDir();
    const folderPath = path.join(skillsDir, name);

    try {
      await fs.access(folderPath);
    } catch {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    await fs.rm(folderPath, { recursive: true, force: true });
    await reloadServerContext();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Skills API] DELETE error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
