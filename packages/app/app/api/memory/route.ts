import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';
import {
  getPrimaryMemoryDir,
  readAllMemories,
  writeMemory,
  updateMemory,
  deleteMemory,
  ensureMemoryDirExists,
  type MemoryType,
} from '@the-thing/core';

export const runtime = 'nodejs';

async function getMemoryDir(): Promise<string | null> {
  const rt = await getServerRuntime();
  return getPrimaryMemoryDir(rt.layout);
}

function validateId(id: string): boolean {
  return /^[a-z0-9]+$/i.test(id);
}

export async function GET() {
  try {
    const dir = await getMemoryDir();
    if (!dir) return NextResponse.json({ memories: [] });

    await ensureMemoryDirExists(dir);
    const memories = await readAllMemories(dir);
    return NextResponse.json({ memories });
  } catch (error) {
    console.error('[Memory API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load memories' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { content, type, dimension, source, importance } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Missing required field: content' }, { status: 400 });
    }

    const validTypes: MemoryType[] = ['preference', 'identity', 'correction', 'explicit'];
    if (type && !validTypes.includes(type)) {
      return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 });
    }

    const dir = await getMemoryDir();
    if (!dir) return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });

    await ensureMemoryDirExists(dir);
    const id = await writeMemory(dir, {
      content,
      type: type ?? 'explicit',
      dimension: dimension || undefined,
      source: source || undefined,
      importance: importance || undefined,
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[Memory API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create memory' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, content } = body;

    if (!id || !validateId(id) || !content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid id/content' }, { status: 400 });
    }

    const dir = await getMemoryDir();
    if (!dir) return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });

    await updateMemory(dir, id, content);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Memory API] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update memory' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const all = searchParams.get('all') === 'true';

    const dir = await getMemoryDir();
    if (!dir) return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });

    if (all) {
      const memories = await readAllMemories(dir);
      for (const m of memories) {
        await deleteMemory(dir, m.id);
      }
      return NextResponse.json({ success: true, deleted: memories.length });
    }

    if (!id || !validateId(id)) {
      return NextResponse.json({ error: 'Missing or invalid id' }, { status: 400 });
    }

    await deleteMemory(dir, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Memory API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 });
  }
}
