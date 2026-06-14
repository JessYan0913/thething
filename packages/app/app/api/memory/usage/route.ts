import { getServerRuntime } from '@/lib/runtime';
import path from 'path';
import { NextResponse } from 'next/server';
import { getUserMemoryDir, getAllMemoryUsage, scanMemoryFiles, findPromotableMemories } from '@the-thing/core';

export const runtime = 'nodejs';

/**
 * GET /api/memory/usage?userId=xxx
 *
 * 返回指定用户的记忆使用数据和晋升统计
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId query parameter' }, { status: 400 });
    }

    const rt = await getServerRuntime();
    const memoryDir = rt.layout.resources.memory[0];
    if (!memoryDir) {
      return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }

    const userMemoryDir = getUserMemoryDir(userId, memoryDir);

    // 获取使用数据
    const usageData = await getAllMemoryUsage(userMemoryDir);

    // 获取可晋升记忆数量
    const memories = await scanMemoryFiles(userMemoryDir);
    const promotable = await findPromotableMemories(memories, userMemoryDir);

    return NextResponse.json({
      usage: usageData,
      promotableCount: promotable.length,
      promotableNames: promotable.map((p) => p.memory.name),
    });
  } catch (error) {
    console.error('[Memory API] GET /usage error:', error);
    return NextResponse.json({ error: 'Failed to load usage data' }, { status: 500 });
  }
}
