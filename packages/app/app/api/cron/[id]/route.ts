import { getServerRuntime } from '@/lib/runtime';
import { validateCronExpression } from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
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

    const executions = rt.cronStore.getExecutions(id, 20);
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
