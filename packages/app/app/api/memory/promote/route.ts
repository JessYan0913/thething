import { getServerRuntime } from '@/lib/runtime';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { getUserMemoryDir, findPromotableMemories } from '@the-thing/core';
import { scanMemoryFiles } from '@the-thing/core';

export const runtime = 'nodejs';

/**
 * POST /api/memory/promote
 *
 * 批量晋升：将满足条件的 inferred 记忆升级为 promoted
 *
 * Body: { userId: string }
 * Returns: { promoted: Array<{ name, filename, reason }>, count: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const rt = await getServerRuntime();
    const memoryDir = rt.layout.resources.memory[0];
    if (!memoryDir) {
      return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }

    const userMemoryDir = getUserMemoryDir(userId, memoryDir);

    // 扫描所有记忆
    const memories = await scanMemoryFiles(userMemoryDir);

    // 找出可晋升的记忆
    const promotable = await findPromotableMemories(memories, userMemoryDir);

    if (promotable.length === 0) {
      return NextResponse.json({ promoted: [], count: 0 });
    }

    // 逐个晋升：更新文件的 frontmatter
    const promoted: Array<{ name: string; filename: string }> = [];

    for (const item of promotable) {
      try {
        const filePath = path.join(userMemoryDir, item.memory.filename);
        const content = await fs.readFile(filePath, 'utf-8');

        // 替换 frontmatter 中的 source 和 confidence
        const updated = content
          .replace(/^source:\s*.*$/m, 'source: promoted')
          .replace(/^confidence:\s*.*$/m, 'confidence: 0.6');

        await fs.writeFile(filePath, updated, 'utf-8');
        promoted.push({ name: item.memory.name, filename: item.memory.filename });
      } catch {
        // 单条失败不阻止其他条目
      }
    }

    return NextResponse.json({ promoted, count: promoted.length });
  } catch (error) {
    console.error('[Memory API] POST /promote error:', error);
    return NextResponse.json({ error: 'Failed to promote memories' }, { status: 500 });
  }
}
