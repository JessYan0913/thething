import path from 'path'
import { nanoid } from 'nanoid'
import { getDatabase } from '../../services/datastore/sqlite/native-loader'
import type { SqliteDatabase } from '../../primitives/datastore/types'
import type { CronJob, CronJobCreateInput, CronJobUpdateInput, CronExecution, CronJobStore } from './types'
import { nextOccurrence } from './cron-expr'

export interface SQLiteCronJobStoreOptions {
  dataDir: string
}

export class SQLiteCronJobStore implements CronJobStore {
  private db: SqliteDatabase

  constructor(options: SQLiteCronJobStoreOptions) {
    const Database = getDatabase()
    this.db = new Database(path.join(options.dataDir, 'cron-jobs.db'))
    this.initialize()
  }

  create(input: CronJobCreateInput): CronJob {
    const now = Date.now()
    const id = nanoid()
    const nextRunAt = input.nextRunAt ?? nextOccurrence(input.schedule, new Date()).getTime()

    this.db.prepare(`
      INSERT INTO cron_jobs (id, name, schedule, prompt, agent_type, conversation_id, enabled, last_run_at, next_run_at, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.schedule,
      input.prompt,
      input.agentType ?? null,
      input.conversationId ?? null,
      input.enabled ? 1 : 0,
      nextRunAt,
      now,
      now,
      input.metadata ? JSON.stringify(input.metadata) : null,
    )

    return this.getById(id)!
  }

  update(id: string, patch: CronJobUpdateInput): CronJob | null {
    const existing = this.getById(id)
    if (!existing) return null

    const now = Date.now()
    const sets: string[] = ['updated_at = ?']
    const values: unknown[] = [now]

    if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name) }
    if (patch.prompt !== undefined) { sets.push('prompt = ?'); values.push(patch.prompt) }
    if (patch.agentType !== undefined) { sets.push('agent_type = ?'); values.push(patch.agentType ?? null) }
    if (patch.conversationId !== undefined) { sets.push('conversation_id = ?'); values.push(patch.conversationId ?? null) }
    if (patch.enabled !== undefined) { sets.push('enabled = ?'); values.push(patch.enabled ? 1 : 0) }
    if (patch.metadata !== undefined) { sets.push('metadata = ?'); values.push(patch.metadata ? JSON.stringify(patch.metadata) : null) }

    if (patch.schedule !== undefined) {
      sets.push('schedule = ?')
      values.push(patch.schedule)
      const nextRunAt = nextOccurrence(patch.schedule, new Date()).getTime()
      sets.push('next_run_at = ?')
      values.push(nextRunAt)
    }

    values.push(id)
    this.db.prepare(`UPDATE cron_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values)

    return this.getById(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id) as unknown as { changes?: number }
    return (result.changes ?? 0) > 0
  }

  getById(id: string): CronJob | null {
    const row = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToJob(row) : null
  }

  listAll(): CronJob[] {
    const rows = this.db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map(r => this.rowToJob(r))
  }

  listDue(now: number): CronJob[] {
    const rows = this.db.prepare(
      'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC',
    ).all(now) as Record<string, unknown>[]
    return rows.map(r => this.rowToJob(r))
  }

  markRun(id: string, lastRunAt: number, nextRunAt: number): void {
    this.db.prepare(
      'UPDATE cron_jobs SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
    ).run(lastRunAt, nextRunAt, Date.now(), id)
  }

  logExecution(execution: Omit<CronExecution, 'id'>): CronExecution {
    const id = nanoid()
    this.db.prepare(`
      INSERT INTO cron_executions (id, job_id, status, triggered_at, completed_at, error, event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      execution.jobId,
      execution.status,
      execution.triggeredAt,
      execution.completedAt ?? null,
      execution.error ?? null,
      execution.eventId ?? null,
    )
    return { id, ...execution }
  }

  getExecutions(jobId: string, limit = 20): CronExecution[] {
    const rows = this.db.prepare(
      'SELECT * FROM cron_executions WHERE job_id = ? ORDER BY triggered_at DESC LIMIT ?',
    ).all(jobId, limit) as Record<string, unknown>[]
    return rows.map(r => this.rowToExecution(r))
  }

  close(): void {
    this.db.close()
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schedule TEXT NOT NULL,
        prompt TEXT NOT NULL,
        agent_type TEXT,
        conversation_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS cron_executions (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'triggered',
        triggered_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT,
        event_id TEXT,
        FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run
      ON cron_jobs (enabled, next_run_at);

      CREATE INDEX IF NOT EXISTS idx_cron_executions_job
      ON cron_executions (job_id, triggered_at DESC);
    `)
  }

  private rowToJob(row: Record<string, unknown>): CronJob {
    return {
      id: row.id as string,
      name: row.name as string,
      schedule: row.schedule as string,
      prompt: row.prompt as string,
      agentType: (row.agent_type as string) || undefined,
      conversationId: (row.conversation_id as string) || undefined,
      enabled: row.enabled === 1,
      lastRunAt: (row.last_run_at as number) ?? null,
      nextRunAt: row.next_run_at as number,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    }
  }

  private rowToExecution(row: Record<string, unknown>): CronExecution {
    return {
      id: row.id as string,
      jobId: row.job_id as string,
      status: row.status as CronExecution['status'],
      triggeredAt: row.triggered_at as number,
      completedAt: (row.completed_at as number) ?? null,
      error: (row.error as string) ?? null,
      eventId: (row.event_id as string) ?? null,
    }
  }
}
