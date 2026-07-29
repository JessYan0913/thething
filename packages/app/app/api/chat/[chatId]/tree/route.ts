import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId: conversationId } = await params;
    const rt = await getServerRuntime();
    const tree = rt.dataStore.messageStore.getConversationTree(conversationId);
    return NextResponse.json(tree);
  } catch (error) {
    console.error('[Conversation Tree API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load conversation tree' }, { status: 500 });
  }
}
