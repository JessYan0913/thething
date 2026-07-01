import { getServerRuntime } from '@/lib/runtime';
import { validateCronExpression, buildFrontmatter, NO_SCHEDULE } from '@the-thing/core';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

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
      schedule?: string;
      prompt: string;
      agentType?: string;
      conversationId?: string;
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    };

    if (!body.name || !body.prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: name, prompt' },
        { status: 400 },
      );
    }

    const schedule = (body.schedule || '').trim();
    if (schedule) {
      const validationError = validateCronExpression(schedule);
      if (validationError) {
        return NextResponse.json(
          { error: `Invalid cron expression: ${validationError}` },
          { status: 400 },
        );
      }
    }

    const job = rt.cronStore.create({
      name: body.name,
      schedule,
      prompt: body.prompt,
      agentType: body.agentType,
      conversationId: body.conversationId,
      enabled: schedule ? (body.enabled ?? true) : false,
      metadata: {
        source: 'ui',
        ...body.metadata,
      },
    });

    // 同步写 task.md 到 ~/.agents/tasks/<id>/task.md
    try {
      const tasksDir = path.join(os.homedir(), '.agents', 'tasks');
      const taskDir = path.join(tasksDir, job.id);
      await fs.mkdir(taskDir, { recursive: true });
      const frontmatter = buildFrontmatter({
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        enabled: job.enabled,
        agentType: body.agentType,
      });
      const filePath = path.join(taskDir, 'task.md');
      await fs.writeFile(filePath, frontmatter + job.prompt, 'utf-8');
      // 回写 metadata 记录文件路径
      rt.cronStore.update(job.id, {
        metadata: { source: 'task-file', filePath },
      });
    } catch (err) {
      // 写文件失败不中断流程（可能是权限问题或无 ~/.agents/tasks 目录）
      console.error('[Cron API] Failed to write task.md:', err);
    }

    return NextResponse.json({ success: true, job }, { status: 201 });
  } catch (error) {
    console.error('[Cron API] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create cron job' },
      { status: 500 },
    );
  }
}
