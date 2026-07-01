// ============================================================
// Task File Loader — 从 .agents/tasks/<name>/task.md 同步任务定义
// ============================================================
//
// 文件是完整配置来源。每次启动同步所有字段到 SQLite。
// 编辑文件并重启 = 修改任务的全部配置（包括调度）。
// UI 的修改也会同步到 SQLite，但下次启动时文件会覆盖回 SQLite。

import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { parseFrontmatterFile } from '../../primitives/parser';
import { logger } from '../../primitives/logger';
import { NO_SCHEDULE } from './types';
import type { CronJobStore } from './types';

// ============================================================
// Zod Schema — 完整任务定义
// ============================================================

export const TaskFrontmatterSchema = z.object({
  /** Dot Agents 协议标记 */
  kind: z.literal('task').optional(),
  /** 任务唯一标识（用作 CronJob.id） */
  id: z.string().min(1),
  /** 人类可读名称 */
  name: z.string().min(1),
  /** 关联的 Agent profile ID（映射到 CronJob.agentType） */
  profileId: z.string().optional(),
  /** Dot Agents 协议原生调度：每隔 N 分钟执行 */
  intervalMinutes: z.number().int().min(1).optional(),
  /** TheThing 扩展：5 字段 cron 表达式（与 intervalMinutes 二选一，同时存在时 intervalMinutes 优先） */
  schedule: z.string().optional(),
  /** 是否启用 */
  enabled: z.boolean().optional().default(true),
  /** 启动时是否立即运行（Phase 1 暂不实现） */
  runOnStartup: z.boolean().optional().default(false),
});

export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;

/**
 * 将 intervalMinutes 转换为标准 5 字段 cron 表达式。
 */
export function intervalMinutesToCron(minutes: number): string {
  if (minutes < 1) {
    throw new Error(`Invalid intervalMinutes: ${minutes}. Must be >= 1.`);
  }

  if (minutes < 60 && 60 % minutes === 0) {
    return `*/${minutes} * * * *`;
  }

  if (minutes === 60) {
    return '0 * * * *';
  }

  if (minutes > 60 && minutes < 1440 && minutes % 60 === 0 && 1440 % minutes === 0) {
    return `0 */${minutes / 60} * * *`;
  }

  if (minutes === 1440) {
    return '0 0 * * *';
  }

  throw new Error(
    `Cannot convert ${minutes}-minute interval to cron. ` +
    `Use the schedule field to specify a 5-field cron expression.`,
  );
}

/**
 * 反向转换：cron 表达式 → intervalMinutes（能转则转，不能转返回 null）。
 * 与 `intervalMinutesToCron` 互逆。
 */
export function cronToIntervalMinutes(schedule: string): number | null {
  // */N * * * *  → N
  const everyNmin = schedule.match(/^\*\/(\d+) \* \* \* \*$/)
  if (everyNmin) return parseInt(everyNmin[1], 10)

  // 0 * * * *  → 60
  if (schedule === '0 * * * *') return 60

  // 0 */N * * *  → N * 60
  const everyNhour = schedule.match(/^0 \*\/(\d+) \* \* \*$/)
  if (everyNhour) return parseInt(everyNhour[1], 10) * 60

  // 0 0 * * *  → 1440
  if (schedule === '0 0 * * *') return 1440

  return null
}

/**
 * 构造写入 task.md 的 frontmatter 字符串。
 * 尽量用 intervalMinutes（协议原生），无法转换时 fallback 到 schedule（cron）。
 */
export function buildFrontmatter(opts: {
  id: string; name: string; schedule: string; enabled: boolean; agentType?: string
}): string {
  const lines = [
    '---',
    `kind: task`,
    `id: ${opts.id}`,
    `name: ${opts.name}`,
  ]

  const interval = cronToIntervalMinutes(opts.schedule)
  if (interval !== null) {
    lines.push(`intervalMinutes: ${interval}`)
  } else {
    lines.push(`schedule: ${opts.schedule}`)
  }

  lines.push(`enabled: ${opts.enabled}`)
  if (opts.agentType) lines.push(`profileId: ${opts.agentType}`)
  lines.push('---', '')
  return lines.join('\n')
}

// ============================================================
// 目录扫描
// ============================================================

interface TaskFileEntry {
  filePath: string;
  id: string;
  source: 'user' | 'project';
}

async function scanTaskDir(dir: string, source: 'user' | 'project'): Promise<TaskFileEntry[]> {
  const results: TaskFileEntry[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const taskDir = path.join(dir, entry.name);
      const taskFile = path.join(taskDir, 'task.md');

      try {
        await fs.stat(taskFile);
        results.push({ filePath: taskFile, id: entry.name, source });
      } catch {
        // 该目录下没有 task.md，跳过
      }
    }
  } catch {
    // 目录不存在，跳过
  }

  return results;
}

// ============================================================
// 主加载函数 — 文件是完整配置，每次都同步
// ============================================================

export interface TaskLoaderOptions {
  /** CronJobStore 实例 */
  store: CronJobStore;
  /** 用户级 tasks 目录（~/.agents/tasks） */
  userDir: string;
  /** 项目级 tasks 目录（<project>/.agents/tasks） */
  projectDir: string;
}

/**
 * 从 .agents/tasks/<name>/task.md 同步任务定义到 Store。
 *
 * 每次启动都从文件读取调度配置（intervalMinutes / schedule / enabled），
 * 覆写到 SQLite。文件是权威配置源。
 */
export async function loadTasksFromFiles(options: TaskLoaderOptions): Promise<void> {
  const { store, userDir, projectDir } = options;

  // 1. 扫描目录
  const userEntries = await scanTaskDir(userDir, 'user');
  const projectEntries = await scanTaskDir(projectDir, 'project');
  const allEntries = [...userEntries, ...projectEntries];

  if (allEntries.length === 0) {
    logger.info('TaskLoader', 'No task files found');
    return;
  }

  // 2. 解析每个文件
  interface ParsedTask {
    id: string;
    filePath: string;
    data: TaskFrontmatter;
    body: string;
    source: 'user' | 'project';
  }

  const parsedTasks: ParsedTask[] = [];

  for (const entry of allEntries) {
    try {
      const parseResult = await parseFrontmatterFile(entry.filePath, TaskFrontmatterSchema);
      parsedTasks.push({
        id: parseResult.data.id,
        filePath: entry.filePath,
        data: parseResult.data,
        body: parseResult.body,
        source: entry.source,
      });
    } catch (err) {
      logger.warn('TaskLoader', `Failed to parse ${entry.filePath}: ${(err as Error).message}`);
    }
  }

  // 3. 按 ID 合并（project 覆盖 user）
  const merged = new Map<string, ParsedTask>();
  for (const source of ['user', 'project'] as const) {
    for (const task of parsedTasks) {
      if (task.source === source) {
        merged.set(task.id, task);
      }
    }
  }

  // 4. 同步到 Store
  let synced = 0;
  for (const [taskId, task] of merged) {
    // 确定 cron schedule（intervalMinutes 优先于 schedule）
    let computedSchedule: string;
    if (task.data.intervalMinutes) {
      try {
        computedSchedule = intervalMinutesToCron(task.data.intervalMinutes);
      } catch {
        logger.warn('TaskLoader', `Task "${taskId}": cannot convert intervalMinutes=${task.data.intervalMinutes} to cron. Falling back to schedule field.`);
        computedSchedule = task.data.schedule || NO_SCHEDULE;
      }
    } else if (task.data.schedule) {
      computedSchedule = task.data.schedule;
    } else {
      computedSchedule = NO_SCHEDULE;
    }

    const updatePayload: Record<string, unknown> = {
      name: task.data.name,
      prompt: task.body,
      agentType: task.data.profileId || undefined,
      schedule: computedSchedule,
      enabled: task.data.enabled,
      intervalMinutes: task.data.intervalMinutes,
      metadata: { source: 'task-file', filePath: task.filePath },
    };

    const existing = store.getById(taskId);
    if (existing) {
      store.update(taskId, updatePayload);
    } else {
      store.create({
        id: taskId,
        ...updatePayload,
      } as any);
    }
    synced++;
  }

  logger.info('TaskLoader', `Synced ${synced} task(s) from files`);
}
