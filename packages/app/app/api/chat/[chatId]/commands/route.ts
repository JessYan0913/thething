import { getServerRuntime } from '@/lib/runtime';
import { abortChat } from '@/lib/stream-manager';
import type { ConversationCommand } from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId: conversationId } = await params;
    const command = await request.json() as ConversationCommand;
    if (!command?.type) {
      return NextResponse.json({ error: 'Missing command type' }, { status: 400 });
    }
    abortChat(conversationId);
    const rt = await getServerRuntime();
    const result = rt.dataStore.branchStore.executeCommand(conversationId, command);
    const projection = rt.dataStore.branchStore.getProjection(conversationId);
    return NextResponse.json({ success: true, result, projection });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute conversation command';
    const status = message.includes('conflict') ? 409 : message.includes('does not belong') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
