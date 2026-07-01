import { getServerRuntime } from '@/lib/runtime';
import { validateCronExpression, buildFrontmatter } from '@the-thing/core';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Extract plain text from UIMessage parts */
function extractText(parts: unknown[]): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is { type: string; text: string } => {
      if (typeof p !== 'object' || p === null) return false;
      const obj = p as Record<string, unknown>;
      return obj.type === 'text' && typeof obj.text === 'string';
    })
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
    const existing = rt.cronStore.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Cron job not found' }, { status: 404 });
    }

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

    // 清空 schedule → 自动禁用任务
    if ('schedule' in body && !body.schedule) {
      body.enabled = false;
    }

    const job = rt.cronStore.update(id, body);
    if (!job) {
      return NextResponse.json({ error: 'Cron job not found' }, { status: 404 });
    }

    // 同步写回 task.md（如果该任务有文件）
    const filePath = existing.metadata?.filePath as string | undefined;
    if (filePath) {
      try {
        const frontmatter = buildFrontmatter({
          id: job.id,
          name: job.name,
          schedule: job.schedule,
          enabled: job.enabled,
          agentType: job.agentType,
        });
        await fs.writeFile(filePath, frontmatter + job.prompt, 'utf-8');
      } catch (err) {
        console.error('[Cron API] Failed to sync task.md:', err);
      }
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
    const existing = rt.cronStore.getById(id);

    // 如果有文件，先删文件
    const filePath = existing?.metadata?.filePath as string | undefined;
    if (filePath) {
      try {
        await fs.unlink(filePath);
        await fs.rmdir(path.dirname(filePath)).catch(() => {});
      } catch (err) {
        console.error('[Cron API] Failed to delete task.md:', err);
      }
    }

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
