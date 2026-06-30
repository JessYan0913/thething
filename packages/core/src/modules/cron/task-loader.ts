// ============================================================
// Task File Loader - 从 .agents/tasks/<name>/task.md 加载任务
// ============================================================
//
// Dot Agents 协议声明式文件格式：
//
// ```markdown
// ---
// kind: task
// id: daily-code-review
// name: Daily Code Review
// intervalMinutes: 60
// enabled: true
// runOnStartup: false
// profileId: abc-123
// ---
// Review all open pull requests...
// ```
//
// 支持 TheThing 扩展字段 `schedule`（5 字段 cron 表达式）。
// schedule 和 intervalMinutes 至少提供其一。

import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { parseFrontmatterFile } from '../../primitives/parser';
import { logger } from '../../primitives/logger';
import type { CronJobStore } from './types';

// ============================================================
// Zod Schema
// ============================================================

export const TaskFrontmatterSchema = z.object({
  /** Dot Agents 协议标记 */
  kind: z.literal('task').optional(),
  /** 任务唯一标识（用作 CronJob.id） */
  id: z.string().min(1),
  /** 人类可读名称 */
  name: z.string().min(1),
  /** 运行间隔（分钟），与 schedule 二选一 */
  intervalMinutes: z.number().int().min(1).optional(),
  /** TheThing 扩展：5 字段 cron 表达式（与 intervalMinutes 二选一，同时存在时优先） */
  schedule: z.string().optional(),
  /** 是否启用 */
  enabled: z.boolean().optional().default(true),
  /** 启动时是否立即运行（Phase 1 暂不实现） */
  runOnStartup: z.boolean().optional().default(false),
  /** 关联的 Agent profile ID（映射到 CronJob.agentType） */
  profileId: z.string().optional(),
});

export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;

// ============================================================
// intervalMinutes → 5 字段 cron 转换
// ============================================================

/**
 * 将 intervalMinutes 转换为标准 5 字段 cron 表达式。
 *
 * 支持的转换：
 *
 *   - < 60, 60 % N  →  `{asterisk}/N * * * *`
 *   - 60             →  `0 {asterisk} * * *`
 *   - >60,<1440,整除 →  `0 {asterisk}/N * * *`
 *   - 1440           →  `0 0 {asterisk} * *`
 *
 * 无法转换的值（如 90）需通过 schedule 字段手动指定 cron 表达式。
 */
export function intervalMinutesToCron(minutes: number): string {
  if (minutes < 1) {
    throw new Error(`Invalid intervalMinutes: ${minutes}. Must be >= 1.`);
  }

  // 每 N 分钟（N 能被 60 整除）
  if (minutes < 60 && 60 % minutes === 0) {
    return `*/${minutes} * * * *`;
  }

  // 每小时
  if (minutes === 60) {
    return '0 * * * *';
  }

  // 每 N 小时（步长必须是整数且能被 24 整除）
  if (minutes > 60 && minutes < 1440 && minutes % 60 === 0 && 1440 % minutes === 0) {
    return `0 */${minutes / 60} * * *`;
  }

  // 每天
  if (minutes === 1440) {
    return '0 0 * * *';
  }

  throw new Error(
    `Cannot convert ${minutes}-minute interval to cron. ` +
    `Add a "schedule" field with a 5-field cron expression to your task.md.`,
  );
}

// ============================================================
// 目录扫描
// ============================================================

interface TaskFileEntry {
  filePath: string;
  id: string;
  source: 'user' | 'project';
}

/**
 * 扫描指定目录下的所有 <name>/task.md 文件
 */
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
        // 用目录名作为初始 id，后面从 frontmatter 读取真实 id
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
// 主加载函数
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
 * 从 .agents/tasks/<name>/task.md 加载任务定义并注册到 CronJobStore。
 *
 * 加载顺序：
 * 1. 扫描 ~/.agents/tasks/（用户层）
 * 2. 扫描 <project>/.agents/tasks/（项目层）
 * 3. 按 task id 合并（项目层覆盖用户层）
 * 4. 清理上次加载的文件任务
 * 5. 插入到 CronJobStore
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
  // 先处理 user（低优先级），再处理 project（高优先级）
  for (const source of ['user', 'project'] as const) {
    for (const task of parsedTasks) {
      if (task.source === source) {
        merged.set(task.id, task);
      }
    }
  }

  // 4. 清理上次加载的文件任务
  const removed = store.deleteByMetadata('source', 'task-file');
  if (removed > 0) {
    logger.info('TaskLoader', `Cleared ${removed} previously loaded file tasks`);
  }

  // 5. 插入到 store
  let loaded = 0;
  for (const [taskId, task] of merged) {
    // 确定 cron 表达式
    let schedule: string;
    if (task.data.schedule) {
      schedule = task.data.schedule;
    } else if (task.data.intervalMinutes) {
      try {
        schedule = intervalMinutesToCron(task.data.intervalMinutes);
      } catch (err) {
        logger.warn('TaskLoader', `Task "${taskId}" (${task.filePath}): ${(err as Error).message}. Skipping.`);
        continue;
      }
    } else {
      logger.warn(
        'TaskLoader',
        `Task "${taskId}" (${task.filePath}) has neither "schedule" nor "intervalMinutes". Skipping.`,
      );
      continue;
    }

    try {
      store.create({
        id: taskId,
        name: task.data.name,
        schedule,
        prompt: task.body,
        agentType: task.data.profileId,
        enabled: task.data.enabled,
        metadata: {
          source: 'task-file',
          filePath: task.filePath,
        },
      });
      loaded++;
    } catch (err) {
      logger.warn('TaskLoader', `Failed to register task "${taskId}" (${task.filePath}): ${(err as Error).message}`);
    }
  }

  logger.info('TaskLoader', `Loaded ${loaded} task(s) from files`);
}
