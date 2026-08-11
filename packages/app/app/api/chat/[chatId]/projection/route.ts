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
    // 前端只用 tree/branches/activeBranchId；不带 messages（大会话全表读巨列的元凶）
    return NextResponse.json(
      rt.dataStore.branchStore.getProjection(conversationId, { includeTree: true })
    );
  } catch (error) {
    console.error('[Conversation Projection API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load conversation projection' }, { status: 500 });
  }
}
