/** 空字符串 schedule 表示"未调度"（任务定义但未激活） */
export const NO_SCHEDULE = ''

export interface CronJob {
  id: string
  name: string
  /** 5-field cron: "minute hour day-of-month month day-of-week"。
   *  空字符串表示未调度，不会触发执行。 */
  schedule: string
  /** Dot Agents 协议原生调度字段：每隔 N 分钟执行一次。
   *  schedule 为空时以此值为准（转换为 cron）。
   *  两者都为空 → 未调度。 */
  intervalMinutes?: number
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
  id?: string
  nextRunAt?: number
}

export type CronJobUpdateInput = Partial<Pick<
  CronJob,
  'name' | 'schedule' | 'intervalMinutes' | 'prompt' | 'agentType' | 'conversationId' | 'enabled' | 'metadata'
>>

export interface CronJobStore {
  create(input: CronJobCreateInput): CronJob
  update(id: string, patch: CronJobUpdateInput): CronJob | null
  delete(id: string): boolean
  deleteByMetadata(key: string, value: unknown): number
  getById(id: string): CronJob | null
  listAll(): CronJob[]
  listDue(now: number): CronJob[]
  markRun(id: string, lastRunAt: number, nextRunAt: number): void
  logExecution(execution: Omit<CronExecution, 'id'>): CronExecution
  getExecutions(jobId: string, limit?: number): CronExecution[]
  close(): void
}
