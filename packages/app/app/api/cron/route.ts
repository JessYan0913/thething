import { getServerRuntime } from '@/lib/runtime';
import { validateCronExpression, nextOccurrence } from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const rt = await getServerRuntime();
    if (!rt.cronStore) {
      return NextResponse.json({ error: 'Cron scheduler not available' }, { status: 503 });
    }

    const jobs = rt.cronStore.listAll();
    return NextResponse.json({ jobs, total: jobs.length });
  } catch (error) {
    console.error('[Cron API] GET error:', error);
    return NextResponse.json({ error: 'Failed to list cron jobs' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const rt = await getServerRuntime();
    if (!rt.cronStore) {
      return NextResponse.json({ error: 'Cron scheduler not available' }, { status: 503 });
    }

    const body = await request.json() as {
      name: string;
      schedule: string;
      prompt: string;
      agentType?: string;
      conversationId?: string;
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    };

    if (!body.name || !body.schedule || !body.prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: name, schedule, prompt' },
        { status: 400 },
      );
    }

    const validationError = validateCronExpression(body.schedule);
    if (validationError) {
      return NextResponse.json(
        { error: `Invalid cron expression: ${validationError}` },
        { status: 400 },
      );
    }

    const job = rt.cronStore.create({
      name: body.name,
      schedule: body.schedule,
      prompt: body.prompt,
      agentType: body.agentType,
      conversationId: body.conversationId,
      enabled: body.enabled ?? true,
      metadata: body.metadata,
    });

    return NextResponse.json({ success: true, job }, { status: 201 });
  } catch (error) {
    console.error('[Cron API] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create cron job' },
      { status: 500 },
    );
  }
}
