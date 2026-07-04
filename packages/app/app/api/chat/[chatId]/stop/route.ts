/**
 * POST /api/chat/[chatId]/stop
 * 停止聊天流 - 显式停止流式响应
 */

import { getStreamManager } from '@/lib/stream-manager';
import { getServerRuntime } from '@/lib/runtime';
import { SQLiteAgentStateStore } from '@the-thing/workflow';
import type { SQLiteDataStore } from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    const streamManager = getStreamManager();

    // 只有流仍在进行中时才停止
    const existing = await streamManager.hasExistingStream(chatId);
    if (existing === true) {
      await streamManager.stopStream(chatId);
    }

    // 清理 workflow state
    try {
      const rt = await getServerRuntime();
      const stateStore = new SQLiteAgentStateStore((rt.dataStore as unknown as SQLiteDataStore).db);
      stateStore.updateStatus(chatId, 'failed');
    } catch {
      // 非关键操作，忽略错误
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Stream API] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to stop stream' },
      { status: 500 }
    );
  }
}
