import { getServerRuntime } from '@/lib/runtime';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import {
  getMemoryFilePath,
  getUserMemoryDir,
  rebuildEntrypoint,
  formatMemoryFrontmatter,
  scanMemoryFiles,
  writeMemoryFile,
  deleteMemoryWithCleanup,
  isTieredStorage,
} from '@the-thing/core';

export const runtime = 'nodejs';

// 各来源的初始置信度（与 @the-thing/core 中 MEMORY_SOURCE_CONFIG 保持一致）
const SOURCE_INITIAL_CONFIDENCE: Record<string, number> = {
  explicit: 0.9,
  inferred: 0.3,
  promoted: 0.6,
};

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

    // 获取用户记忆目录并重建 entrypoint
    const userMemoryDir = path.dirname(filePath);
    const filename = path.basename(filePath);

    // 使用核心模块删除（支持分层存储）
    await deleteMemoryWithCleanup(userMemoryDir, filename);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Memory API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete memory file' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, type, content, userId, source = 'explicit', subject, aliases, context, stability } = body;

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

    const initialConfidence = SOURCE_INITIAL_CONFIDENCE[source] ?? 0.9;

    // 使用核心模块写入（自动检测分层存储）
    const fileName = await writeMemoryFile(
      userMemoryDir,
      {
        name,
        description: description || '',
        type,
        content,
        source: source as 'explicit' | 'inferred' | 'promoted',
        confidence: initialConfidence,
        subject,
        aliases,
        context,
        stability: stability as 'identity' | 'state' | 'pattern' | undefined,
      },
      content,
    );

    // 扁平目录需要重建 entrypoint（分层目录在 writeMemoryFile 中已处理）
    const tiered = await isTieredStorage(userMemoryDir);
    if (!tiered) {
      await rebuildEntrypoint(userMemoryDir);
    }

    return NextResponse.json({ success: true, fileName });
  } catch (error) {
    console.error('[Memory API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create memory' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { filePath, name, description, type, content, source, confidence, subject, aliases, context, stability } = body;

    if (!filePath || !name || !type || content === undefined) {
      return NextResponse.json({ error: 'Missing required fields: filePath, name, type, content' }, { status: 400 });
    }

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: 'Memory file not found' }, { status: 404 });
    }

    // 用户编辑时：保留原 source，confidence 重置为 0.9（用户确认过，可靠性最高）
    const finalSource = source || 'explicit';
    const finalConfidence = confidence ?? 0.9;

    // 获取用户记忆目录
    const userMemoryDir = path.dirname(filePath);
    const oldFilename = path.basename(filePath);

    // 使用核心模块删除旧文件
    await deleteMemoryWithCleanup(userMemoryDir, oldFilename);

    // 使用核心模块写入新文件（自动检测分层存储）
    const newFileName = await writeMemoryFile(
      userMemoryDir,
      {
        name,
        description: description || '',
        type,
        content,
        source: finalSource as 'explicit' | 'inferred' | 'promoted',
        confidence: finalConfidence,
        subject,
        aliases,
        context,
        stability: stability as 'identity' | 'state' | 'pattern' | undefined,
      },
      content,
    );

    // 扁平目录需要重建 entrypoint（分层目录在 writeMemoryFile 中已处理）
    const tiered = await isTieredStorage(userMemoryDir);
    if (!tiered) {
      await rebuildEntrypoint(userMemoryDir);
    }

    return NextResponse.json({ success: true, fileName: newFileName });
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

    const allMemories: Array<{
      name: string;
      description: string;
      type: string;
      content: string;
      filePath: string;
      userId: string;
      mtimeMs: number;
      source: string;
      confidence: number;
      subject: string;
      aliases: string[];
      context: string[];
      tier?: string;
    }> = [];
    const entrypoints: Array<{ userId: string; content: string; filePath: string }> = [];

    for (const userId of userIds) {
      const userMemoryDir = path.join(usersDir, userId, 'memory');

      // 读取 MEMORY.md entrypoint
      const entrypointPath = path.join(userMemoryDir, 'MEMORY.md');
      try {
        const content = await fs.readFile(entrypointPath, 'utf-8');
        entrypoints.push({ userId, content, filePath: entrypointPath });
      } catch {
        // no MEMORY.md for this user
      }

      // 使用核心模块扫描（支持分层存储）
      const memories = await scanMemoryFiles(userMemoryDir);
      for (const mem of memories) {
        allMemories.push({
          name: mem.name,
          description: mem.description,
          type: mem.type,
          content: mem.content,
          filePath: mem.filePath,
          userId,
          mtimeMs: mem.mtimeMs,
          source: mem.source,
          confidence: mem.confidence,
          subject: mem.subject,
          aliases: mem.aliases,
          context: mem.context,
          tier: mem.tier,
        });
      }
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
