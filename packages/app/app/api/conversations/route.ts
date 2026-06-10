import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const sourceId = searchParams.get('sourceId');

    const rt = await getServerRuntime();
    let conversations = rt.dataStore.conversationStore.listConversations();

    // Server-side filtering by source
    if (source) {
      conversations = conversations.filter((c) => c.source === source);
    }
    if (sourceId) {
      conversations = conversations.filter((c) => c.sourceId === sourceId);
    }

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('[Conversations API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { id?: string; title?: string };
    if (!body.id) {
      return NextResponse.json({ error: 'Missing conversation id' }, { status: 400 });
    }
    const rt = await getServerRuntime();
    const conversation = rt.dataStore.conversationStore.createConversation(body.id, body.title, { source: 'user' });
    return NextResponse.json({ conversation });
  } catch (error) {
    console.error('[Conversations API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id: string; title: string };
    if (!body.id || !body.title) {
      return NextResponse.json({ error: 'Missing id or title' }, { status: 400 });
    }
    const rt = await getServerRuntime();
    rt.dataStore.conversationStore.updateConversationTitle(body.id, body.title);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Conversations API] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing conversation id' }, { status: 400 });
    }
    const rt = await getServerRuntime();
    rt.dataStore.summaryStore.deleteSummariesByConversation(id);
    rt.dataStore.conversationStore.deleteConversation(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Conversations API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
}
