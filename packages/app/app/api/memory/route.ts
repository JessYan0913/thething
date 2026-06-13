import { getServerRuntime } from '@/lib/runtime';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { getMemoryFilePath, getUserMemoryDir, rebuildEntrypoint } from '@the-thing/core';

export const runtime = 'nodejs';

interface ScannedMemo {
  name: string;
  description: string;
  type: string;
  content: string;
  filePath: string;
  lines: number;
  sizeKb: number;
  userId: string;
  mtimeMs: number;
}

interface EntrypointMemo {
  userId: string;
  content: string;
  filePath: string;
}

function parseFrontmatter(content: string): { data: Record<string, string>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const raw = match[1];
  const body = match[2].trim();
  const data: Record<string, string> = {};

  for (const line of raw.split('\n')) {
    const sep = line.indexOf(':');
    if (sep > 0) {
      data[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
    }
  }

  return { data, body };
}

async function scanUserMemoryDir(userMemoryDir: string, userId: string): Promise<ScannedMemo[]> {
  const results: ScannedMemo[] = [];

  let files: string[];
  try {
    files = await fs.readdir(userMemoryDir);
  } catch {
    return results;
  }

  for (const file of files) {
    if (!file.endsWith('.md') || file === 'MEMORY.md') continue;

    const filePath = path.join(userMemoryDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stat = await fs.stat(filePath);
      const parsed = parseFrontmatter(content);
      const lines = content.split('\n').length;
      const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024;

      results.push({
        name: parsed?.data?.name ?? path.basename(file, '.md'),
        description: parsed?.data?.description ?? '',
        type: parsed?.data?.type ?? 'user',
        content,
        filePath,
        lines,
        sizeKb,
        userId,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('filePath');
    if (!filePath) {
      return NextResponse.json({ error: 'Missing filePath query parameter' }, { status: 400 });
    }

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: 'Memory file not found' }, { status: 404 });
    }

    await fs.unlink(filePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Memory API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete memory file' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, type, content, userId } = body;

    if (!name || !type || !content || !userId) {
      return NextResponse.json({ error: 'Missing required fields: name, type, content, userId' }, { status: 400 });
    }

    const rt = await getServerRuntime();
    const memoryDir = rt.layout.resources.memory[0];
    if (!memoryDir) {
      return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }

    const userMemoryDir = getUserMemoryDir(userId, memoryDir);
    await fs.mkdir(userMemoryDir, { recursive: true });

    const filePath = getMemoryFilePath(userMemoryDir, type, name);

    // 组装文件内容：frontmatter + body
    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${description || ''}`,
      `type: ${type}`,
      '---',
    ].join('\n');
    const fileContent = `${frontmatter}\n\n${content}`;

    await fs.writeFile(filePath, fileContent, 'utf-8');
    await rebuildEntrypoint(userMemoryDir);

    return NextResponse.json({ success: true, filePath });
  } catch (error) {
    console.error('[Memory API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create memory' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { filePath, name, description, type, content } = body;

    if (!filePath || !name || !type || content === undefined) {
      return NextResponse.json({ error: 'Missing required fields: filePath, name, type, content' }, { status: 400 });
    }

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: 'Memory file not found' }, { status: 404 });
    }

    // 组装文件内容：frontmatter + body
    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${description || ''}`,
      `type: ${type}`,
      '---',
    ].join('\n');
    const fileContent = `${frontmatter}\n\n${content}`;

    await fs.writeFile(filePath, fileContent, 'utf-8');

    // 重建所在用户目录的 entrypoint
    const userMemoryDir = path.dirname(filePath);
    await rebuildEntrypoint(userMemoryDir);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Memory API] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update memory' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const rt = await getServerRuntime();
    const memoryDir = rt.layout.resources.memory[0];

    if (!memoryDir) {
      return NextResponse.json({ memory: [], entrypoints: [] });
    }

    const usersDir = path.join(memoryDir, 'users');
    let userIds: string[] = [];
    try {
      const entries = await fs.readdir(usersDir, { withFileTypes: true });
      userIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      // users dir not exists
    }

    const allMemories: ScannedMemo[] = [];
    const entrypoints: EntrypointMemo[] = [];

    for (const userId of userIds) {
      const userMemoryDir = path.join(usersDir, userId, 'memory');

      const entrypointPath = path.join(userMemoryDir, 'MEMORY.md');
      try {
        const content = await fs.readFile(entrypointPath, 'utf-8');
        entrypoints.push({ userId, content, filePath: entrypointPath });
      } catch {
        // no MEMORY.md for this user
      }

      const memos = await scanUserMemoryDir(userMemoryDir, userId);
      allMemories.push(...memos);
    }

    return NextResponse.json({
      memory: allMemories,
      entrypoints,
      baseDir: memoryDir,
    });
  } catch (error) {
    console.error('[Memory API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load memory' }, { status: 500 });
  }
}
