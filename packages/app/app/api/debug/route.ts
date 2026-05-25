import { getServerRuntime } from '@/lib/runtime';
import { estimateMessagesTokens } from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'compaction') {
      const conversationId = searchParams.get('conversationId');
      if (!conversationId) {
        return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
      }

      const rt = await getServerRuntime();
      const store = rt.dataStore;
      const messages = store.messageStore.getMessagesByConversation(conversationId);
      const tokenCount = await estimateMessagesTokens(messages);
      const summary = store.summaryStore.getSummaryByConversation(conversationId);

      const boundaryMessages = messages.filter(m => {
        if (m.role !== 'system') return false;
        return m.parts.some(p =>
          p.type === 'text' && p.text.includes('SYSTEM_COMPACT_BOUNDARY')
        );
      });

      return NextResponse.json({
        conversationId,
        messageCount: messages.length,
        estimatedTokens: tokenCount,
        compactThreshold: 60000,
        wouldTriggerCompaction: tokenCount > 60000,
        hasSummary: !!summary,
        summary: summary ? {
          compactedAt: summary.compactedAt,
          preCompactTokens: summary.preCompactTokenCount,
          lastMessageOrder: summary.lastMessageOrder,
          summaryPreview: summary.summary.slice(0, 200),
        } : null,
        boundaryMessageCount: boundaryMessages.length,
      });
    }

    // Default: health check
    const rt = await getServerRuntime();
    return NextResponse.json({
      success: true,
      runtime: {
        hasDataStore: !!rt.dataStore,
        hasLayout: !!rt.layout,
        hasBehavior: !!rt.behavior,
      }
    });
  } catch (error) {
    console.error('[Debug API] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
