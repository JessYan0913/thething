import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// 手动清理会话膨胀：剥离瞬态 data-* part + 删除孤儿分支消息。
// 只清理被丢弃的历史版本（不可达消息），活跃路径与分支 tip 全部保留。
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId: conversationId } = await params;
    const rt = await getServerRuntime();
    const stats = rt.dataStore.messageStore.pruneConversation(conversationId);
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error('[Conversation Prune API] POST error:', error);
    return NextResponse.json({ error: 'Failed to prune conversation' }, { status: 500 });
  }
}
