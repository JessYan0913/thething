export interface CronJob {
  id: string
  name: string
  /** 5-field cron: "minute hour day-of-month month day-of-week" */
  schedule: string
  prompt: string
  agentType?: string
  conversationId?: string
  enabled: boolean
  lastRunAt: number | null
  nextRunAt: number
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export interface CronExecution {
  id: string
  jobId: string
  status: 'triggered' | 'completed' | 'failed'
  triggeredAt: number
  completedAt: number | null
  duration: number | null
  conversationId: string | null
  error: string | null
  eventId: string | null
}

export type CronJobCreateInput = Omit<CronJob, 'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt'> & {
  nextRunAt?: number
}

export type CronJobUpdateInput = Partial<Pick<
  CronJob,
  'name' | 'schedule' | 'prompt' | 'agentType' | 'conversationId' | 'enabled' | 'metadata'
>>

export interface CronJobStore {
  create(input: CronJobCreateInput): CronJob
  update(id: string, patch: CronJobUpdateInput): CronJob | null
  delete(id: string): boolean
  getById(id: string): CronJob | null
  listAll(): CronJob[]
  listDue(now: number): CronJob[]
  markRun(id: string, lastRunAt: number, nextRunAt: number): void
  logExecution(execution: Omit<CronExecution, 'id'>): CronExecution
  getExecutions(jobId: string, limit?: number): CronExecution[]
  close(): void
}
