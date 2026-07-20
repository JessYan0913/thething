// ============================================================
// POST /api/chat/[chatId]/branch
// ============================================================
// body: { messageId, descendToTip? }

import { getServerRuntime } from '@/lib/runtime';
import { abortChat } from '@/lib/stream-manager';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId: conversationId } = await params;
    const body = await request.json() as {
      messageId: string;
      descendToTip?: boolean;
    };
    const { messageId, descendToTip } = body;

    if (!messageId) {
      return NextResponse.json({ error: 'Missing messageId' }, { status: 400 });
    }

    // 运行中切分支：先终止当前运行，其迟到的 append 会因 head CAS 落为孤儿分支
    abortChat(conversationId);

    const rt = await getServerRuntime();
    const store = rt.dataStore;
    const ok = store.messageStore.switchHead(conversationId, messageId, descendToTip ?? true);
    if (!ok) {
      return NextResponse.json({ error: 'Message not found in conversation' }, { status: 404 });
    }

    const messages = store.messageStore.getMessagesByConversation(conversationId);
    const { branches, headChildId } = store.messageStore.getBranchInfo(conversationId);
    return NextResponse.json({ success: true, messages, branches, headChildId });
  } catch (error) {
    console.error('[Branch API] POST error:', error);
    return NextResponse.json({ error: 'Failed to switch branch' }, { status: 500 });
  }
}
