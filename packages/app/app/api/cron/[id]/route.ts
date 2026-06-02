import { getServerRuntime } from '@/lib/runtime';
import { validateCronExpression } from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Extract plain text from UIMessage parts */
function extractText(parts: unknown[]): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is { type: string; text: string } => typeof p === 'object' && p !== null && 'text' in p && (p as { type: string }).type === 'text')
    .map(p => p.text)
    .join('');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rt = await getServerRuntime();
    if (!rt.cronStore) {
      return NextResponse.json({ error: 'Cron scheduler not available' }, { status: 503 });
    }

    const { id } = await params;
    const job = rt.cronStore.getById(id);
    if (!job) {
      return NextResponse.json({ error: 'Cron job not found' }, { status: 404 });
    }

    const url = new URL(request.url);
    const includeMessages = url.searchParams.get('messages') === 'true';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const executions = rt.cronStore.getExecutions(id, limit);

    if (includeMessages && rt.dataStore?.messageStore) {
      const executionsWithMessages = executions.map(exec => {
        if (!exec.conversationId) return { ...exec, messages: [] };
        const rawMessages = rt.dataStore.messageStore.getMessagesByConversation(exec.conversationId);
        const messages = rawMessages.map(m => ({
          id: m.id,
          role: m.role,
          text: extractText(m.parts as unknown[]),
        }));
        return { ...exec, messages };
      });
      return NextResponse.json({ job, executions: executionsWithMessages });
    }

    return NextResponse.json({ job, executions });
  } catch (error) {
    console.error('[Cron API] GET error:', error);
    return NextResponse.json({ error: 'Failed to get cron job' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rt = await getServerRuntime();
    if (!rt.cronStore) {
      return NextResponse.json({ error: 'Cron scheduler not available' }, { status: 503 });
    }

    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;

    if (body.schedule && typeof body.schedule === 'string') {
      const validationError = validateCronExpression(body.schedule);
      if (validationError) {
        return NextResponse.json(
          { error: `Invalid cron expression: ${validationError}` },
          { status: 400 },
        );
      }
    }

    const job = rt.cronStore.update(id, body);
    if (!job) {
      return NextResponse.json({ error: 'Cron job not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error('[Cron API] PATCH error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update cron job' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rt = await getServerRuntime();
    if (!rt.cronStore) {
      return NextResponse.json({ error: 'Cron scheduler not available' }, { status: 503 });
    }

    const { id } = await params;
    const deleted = rt.cronStore.delete(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Cron job not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Cron API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete cron job' }, { status: 500 });
  }
}
