import { tool } from 'ai'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import type { CronJobStore } from '../cron/types'
import { validate } from '../cron/cron-expr'
import { buildFrontmatter, cronToIntervalMinutes } from '../cron/task-loader'
import { logger } from '../../primitives/logger'

export interface CronToolOptions {
  cronStore: CronJobStore
  /** 文件式 tasks 根目录（~/.agents/tasks），create 时可选写 task.md */
  tasksDir?: string
}

/** 将任务名转为文件系统友好的 kebab-case ID */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function createCronTool(options: CronToolOptions) {
  return tool({
    description: '管理定时自动化任务。可以创建、查看、更新、删除定时任务，任务会按 cron 表达式自动触发 Agent 执行。',
    inputSchema: z.object({
      action: z.enum(['create', 'list', 'get', 'update', 'delete', 'enable', 'disable'])
        .describe('操作类型'),
      id: z.string().optional()
        .describe('任务 ID（create 时可选，默认由名称自动生成；get/update/delete/enable/disable 时必填）'),
      name: z.string().optional()
        .describe('任务名称（create 时必填）'),
      schedule: z.string().optional()
        .describe('Cron 表达式，5 字段格式："分 时 日 月 周"，如 "0 9 * * 1-5" 表示工作日每天 9 点（create 时必填）'),
      prompt: z.string().optional()
        .describe('Agent 执行的指令/提示词（create 时必填）'),
      agentType: z.string().optional()
        .describe('使用的 Agent 类型（可选）'),
      conversationId: z.string().optional()
        .describe('绑定到指定对话 ID，每次追加消息；不填则每次创建新对话'),
      enabled: z.boolean().optional()
        .describe('是否启用（默认 true）'),
    }),
    execute: async (input) => {
      const { cronStore } = options

      switch (input.action) {
        case 'create': {
          if (!input.name) return { error: true, message: '缺少 name 参数' }
          if (!input.schedule) return { error: true, message: '缺少 schedule 参数' }
          if (!input.prompt) return { error: true, message: '缺少 prompt 参数' }

          const validationError = validate(input.schedule)
          if (validationError) {
            return { error: true, message: `无效的 cron 表达式: ${validationError}` }
          }

          const taskId = input.id || slugify(input.name)

          const job = cronStore.create({
            id: taskId,
            name: input.name,
            schedule: input.schedule,
            prompt: input.prompt,
            agentType: input.agentType,
            conversationId: input.conversationId,
            enabled: input.enabled ?? true,
            metadata: {
              ...(options.tasksDir ? { source: 'task-file' } : {}),
            },
          })

          // 可选写 task.md（失败不中断流程）
          if (options.tasksDir) {
            try {
              const taskDir = path.join(options.tasksDir, taskId)
              await fs.mkdir(taskDir, { recursive: true })
              const frontmatter = buildFrontmatter({
                id: taskId,
                name: input.name,
                schedule: input.schedule,
                enabled: input.enabled ?? true,
                agentType: input.agentType,
              })
              await fs.writeFile(path.join(taskDir, 'task.md'), frontmatter + input.prompt, 'utf-8')
              // 更新 metadata 记录文件路径
              cronStore.update(taskId, {
                intervalMinutes: cronToIntervalMinutes(input.schedule) ?? undefined,
                metadata: { source: 'task-file', filePath: path.join(taskDir, 'task.md') },
              })
            } catch (err) {
              logger.warn('Cron', `写入 task.md 失败: ${(err as Error).message}`)
            }
          }

          const nextRun = new Date(job.nextRunAt)
          return {
            success: true,
            job: { id: job.id, name: job.name, schedule: job.schedule, enabled: job.enabled },
            message: `已创建定时任务「${job.name}」（${taskId}），下次执行时间: ${nextRun.toLocaleString()}`,
          }
        }

        case 'list': {
          const jobs = cronStore.listAll()
          return {
            success: true,
            total: jobs.length,
            jobs: jobs.map(j => ({
              id: j.id,
              name: j.name,
              schedule: j.schedule,
              intervalMinutes: j.intervalMinutes,
              prompt: j.prompt.slice(0, 100) + (j.prompt.length > 100 ? '...' : ''),
              enabled: j.enabled,
              source: j.metadata?.source === 'task-file' ? 'file' : 'sqlite',
              lastRunAt: j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : null,
              nextRunAt: new Date(j.nextRunAt).toLocaleString(),
            })),
          }
        }

        case 'get': {
          if (!input.id) return { error: true, message: '缺少 id 参数' }
          const job = cronStore.getById(input.id)
          if (!job) return { error: true, message: `任务 ${input.id} 不存在` }
          const executions = cronStore.getExecutions(input.id, 5)
          return {
            success: true,
            job,
            recentExecutions: executions.map(e => ({
              status: e.status,
              triggeredAt: new Date(e.triggeredAt).toLocaleString(),
              duration: e.duration != null ? `${e.duration}ms` : null,
              error: e.error,
            })),
          }
        }

        case 'update': {
          if (!input.id) return { error: true, message: '缺少 id 参数' }

          const existing = cronStore.getById(input.id)
          if (!existing) return { error: true, message: `任务 ${input.id} 不存在` }

          if (input.schedule) {
            const validationError = validate(input.schedule)
            if (validationError) {
              return { error: true, message: `无效的 cron 表达式: ${validationError}` }
            }
          }

          const updatePatch: Record<string, unknown> = {}
          if (input.name !== undefined) updatePatch.name = input.name
          if (input.schedule !== undefined) updatePatch.schedule = input.schedule
          if (input.prompt !== undefined) updatePatch.prompt = input.prompt
          if (input.agentType !== undefined) updatePatch.agentType = input.agentType
          if (input.conversationId !== undefined) updatePatch.conversationId = input.conversationId
          if (input.enabled !== undefined) updatePatch.enabled = input.enabled
          // 如果 schedule 变了，同步更新 intervalMinutes
          if (input.schedule !== undefined) {
            const interval = cronToIntervalMinutes(input.schedule)
            if (interval !== null) updatePatch.intervalMinutes = interval
            else updatePatch.intervalMinutes = null
          }

          const updatedJob = cronStore.update(input.id, updatePatch)
          if (!updatedJob) return { error: true, message: `任务 ${input.id} 不存在` }

          // 同步更新 task.md 文件（如果存在）
          const filePath = existing.metadata?.filePath as string | undefined
          if (filePath) {
            try {
              const frontmatter = buildFrontmatter({
                id: updatedJob.id,
                name: updatedJob.name,
                schedule: updatedJob.schedule,
                enabled: updatedJob.enabled,
                agentType: updatedJob.agentType,
              })
              await fs.writeFile(filePath, frontmatter + updatedJob.prompt, 'utf-8')
            } catch (err) {
              logger.warn('Cron', `更新 task.md 失败: ${(err as Error).message}`)
            }
          }

          return {
            success: true,
            job: { id: updatedJob.id, name: updatedJob.name, schedule: updatedJob.schedule, enabled: updatedJob.enabled },
            message: `已更新定时任务「${updatedJob.name}」`,
          }
        }

        case 'delete': {
          if (!input.id) return { error: true, message: '缺少 id 参数' }

          const taskToDelete = cronStore.getById(input.id)
          if (!taskToDelete) return { error: true, message: `任务 ${input.id} 不存在` }

          // 先删 task.md 文件（如果存在）
          const filePath = taskToDelete.metadata?.filePath as string | undefined
          if (filePath) {
            try {
              await fs.unlink(filePath)
              // 尝试删除空目录（不强制）
              await fs.rmdir(path.dirname(filePath)).catch(() => {})
            } catch (err) {
              logger.warn('Cron', `删除 task.md 失败: ${(err as Error).message}`)
            }
          }

          const deleted = cronStore.delete(input.id)
          if (!deleted) return { error: true, message: `任务 ${input.id} 不存在` }
          return { success: true, message: `已删除定时任务「${taskToDelete.name}」` }
        }

        case 'enable': {
          if (!input.id) return { error: true, message: '缺少 id 参数' }

          const enableJob = cronStore.getById(input.id)
          if (!enableJob) return { error: true, message: `任务 ${input.id} 不存在` }

          const enabledJob = cronStore.update(input.id, { enabled: true })
          return { success: true, message: `已启用定时任务「${enabledJob!.name}」` }
        }

        case 'disable': {
          if (!input.id) return { error: true, message: '缺少 id 参数' }

          const disableJob = cronStore.getById(input.id)
          if (!disableJob) return { error: true, message: `任务 ${input.id} 不存在` }

          const disabledJob = cronStore.update(input.id, { enabled: false })
          return { success: true, message: `已禁用定时任务「${disabledJob!.name}」` }
        }

        default:
          return { error: true, message: `未知操作: ${input.action}` }
      }
    },
  })
}
