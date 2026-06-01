import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rt = await getServerRuntime();
    if (!rt.cronStore || !rt.cronScheduler) {
      return NextResponse.json({ error: 'Cron scheduler not available' }, { status: 503 });
    }

    const { id } = await params;
    const body = await request.json() as { action: string };

    const job = rt.cronStore.getById(id);
    if (!job) {
      return NextResponse.json({ error: 'Cron job not found' }, { status: 404 });
    }

    switch (body.action) {
      case 'trigger': {
        await rt.cronScheduler.triggerJob(id);
        return NextResponse.json({ success: true, message: `任务「${job.name}」已触发执行` });
      }

      case 'enable': {
        const updated = rt.cronStore.update(id, { enabled: true });
        return NextResponse.json({ success: true, job: updated });
      }

      case 'disable': {
        const updated = rt.cronStore.update(id, { enabled: false });
        return NextResponse.json({ success: true, job: updated });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[Cron API] POST action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to execute action' },
      { status: 500 },
    );
  }
}
