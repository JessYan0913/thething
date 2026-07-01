// ============================================================
// In-Memory CronJobStore — 纯内存运行时，JSONL 执行历史
// ============================================================
//
// 任务定义从 .agents/tasks/<name>/task.md 文件加载，
// 运行时状态（nextRunAt、lastRunAt）全在内存中。
// 执行历史写入 <historyDir>/<jobId>.jsonl，重启后保留。

import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { nextOccurrence } from './cron-expr';
import { NO_SCHEDULE } from './types';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput, CronExecution, CronJobStore } from './types';

export interface InMemoryCronJobStoreOptions {
  /** 执行历史文件存放目录（如 layout.dataDir/task-history） */
  historyDir: string;
}

export class InMemoryCronJobStore implements CronJobStore {
  private readonly jobs = new Map<string, CronJob>();
  private readonly historyDir: string;
  private historyDirEnsured = false;

  constructor(options: InMemoryCronJobStoreOptions) {
    this.historyDir = options.historyDir;
  }

  // ============================================================
  // 任务定义
  // ============================================================

  create(input: CronJobCreateInput): CronJob {
    const now = Date.now();
    const id = input.id ?? nanoid();
    // 空 schedule = 未调度，nextRunAt 设为远端安全值
    const nextRunAt = input.nextRunAt
      ?? (input.schedule
        ? nextOccurrence(input.schedule, new Date()).getTime()
        : Number.MAX_SAFE_INTEGER);

    const job: CronJob = {
      id,
      name: input.name,
      schedule: input.schedule || NO_SCHEDULE,
      intervalMinutes: input.intervalMinutes,
      prompt: input.prompt,
      agentType: input.agentType,
      conversationId: input.conversationId,
      enabled: input.enabled,
      lastRunAt: null,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    this.jobs.set(id, job);
    return job;
  }

  update(id: string, patch: CronJobUpdateInput): CronJob | null {
    const existing = this.jobs.get(id);
    if (!existing) return null;

    const now = Date.now();
    const updated: CronJob = {
      ...existing,
      name: patch.name ?? existing.name,
      schedule: patch.schedule ?? existing.schedule,
      intervalMinutes: patch.intervalMinutes !== undefined ? patch.intervalMinutes : existing.intervalMinutes,
      prompt: patch.prompt ?? existing.prompt,
      agentType: patch.agentType !== undefined ? patch.agentType : existing.agentType,
      conversationId: patch.conversationId !== undefined ? patch.conversationId : existing.conversationId,
      enabled: patch.enabled ?? existing.enabled,
      metadata: patch.metadata !== undefined ? patch.metadata : existing.metadata,
      updatedAt: now,
    };

    // 如果 schedule 变了，重新计算 nextRunAt
    if (patch.schedule !== undefined) {
      updated.schedule = patch.schedule || NO_SCHEDULE;
      updated.nextRunAt = patch.schedule
        ? nextOccurrence(patch.schedule, new Date()).getTime()
        : Number.MAX_SAFE_INTEGER;
    }

    this.jobs.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.jobs.delete(id);
  }

  deleteByMetadata(key: string, value: unknown): number {
    let removed = 0;
    for (const [id, job] of this.jobs) {
      if (job.metadata?.[key] === value) {
        this.jobs.delete(id);
        removed++;
      }
    }
    return removed;
  }

  getById(id: string): CronJob | null {
    return this.jobs.get(id) ?? null;
  }

  listAll(): CronJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  listDue(now: number): CronJob[] {
    const due: CronJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.enabled && job.schedule && job.nextRunAt <= now) {
        due.push(job);
      }
    }
    due.sort((a, b) => a.nextRunAt - b.nextRunAt);
    return due;
  }

  markRun(id: string, lastRunAt: number, nextRunAt: number): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.lastRunAt = lastRunAt;
    job.nextRunAt = nextRunAt;
    job.updatedAt = Date.now();
  }

  // ============================================================
  // 执行历史（JSONL 文件）
  // ============================================================

  logExecution(execution: Omit<CronExecution, 'id'>): CronExecution {
    const id = nanoid();
    const record: CronExecution = { id, ...execution };

    try {
      this.ensureHistoryDir();
      const filePath = this.executionFilePath(execution.jobId);
      fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
    } catch (err) {
      // 写入失败不应影响调度流程，静默忽略
      console.error('[Cron] Failed to write execution history:', err);
    }

    return record;
  }

  getExecutions(jobId: string, limit = 20): CronExecution[] {
    try {
      const filePath = this.executionFilePath(jobId);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // 取最后 N 条（最新的在前）
      const entries: CronExecution[] = [];
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
        try {
          entries.push(JSON.parse(lines[i]));
        } catch {
          // 跳过损坏的行
        }
      }
      return entries;
    } catch {
      // 文件不存在或不可读
      return [];
    }
  }

  close(): void {
    this.jobs.clear();
  }

  // ============================================================
  // 辅助
  // ============================================================

  private ensureHistoryDir(): void {
    if (this.historyDirEnsured) return;
    fs.mkdirSync(this.historyDir, { recursive: true });
    this.historyDirEnsured = true;
  }

  private executionFilePath(jobId: string): string {
    return path.join(this.historyDir, `${jobId}.jsonl`);
  }
}
