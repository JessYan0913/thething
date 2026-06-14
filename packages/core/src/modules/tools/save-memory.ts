// ============================================================
// Save Memory Tool - Agent 主动保存记忆
// ============================================================
// 让 Agent 在对话中发现值得记的信息时，主动调用保存

import { tool } from 'ai'
import { z } from 'zod'
import { getUserMemoryDir, ensureMemoryDirExists } from '../memory/paths'
import { writeMemoryFile, updateMemoryFile, deleteMemoryWithCleanup } from '../memory/memory-store'
import { scanMemoryFiles } from '../memory/memory-scan'
import type { MemoryType, MemoryFileData } from '../memory/types'
import type { EntrypointLimits } from '../memory/memdir'
import { logger } from '../../primitives/logger'

const memoryItemSchema = z.object({
  name: z.string().describe('记忆名称（简洁描述性，如"用户偏好"、"项目约束"）'),
  description: z.string().describe('一行描述'),
  type: z
    .enum(['user', 'feedback', 'project', 'reference'])
    .describe('记忆类型: user=用户偏好/背景, feedback=用户对AI行为的评价, project=项目约束/决策, reference=外部工具/服务'),
  content: z
    .string()
    .describe('记忆内容（只写用户明确说出的事实，不加推断）'),
  action: z
    .enum(['create', 'update', 'delete'])
    .describe('操作类型: create=新记忆, update=替换现有记忆, delete=删除过时记忆'),
  targetFilename: z
    .string()
    .optional()
    .describe('update/delete 时的目标文件名（如 user_偏好.md）'),
  subject: z
    .string()
    .optional()
    .describe('记忆主体（如"用户"），用于召回时匹配代词'),
  aliases: z
    .array(z.string())
    .optional()
    .describe('主体的别名或代词（如["我", "主人"]），用于召回时匹配用户原话'),
  context: z
    .array(z.string())
    .optional()
    .describe('关联场景关键词（如["称呼", "身份"]），用于召回时匹配用户提问场景'),
  source: z
    .enum(['explicit', 'inferred'])
    .describe('来源: explicit=用户明确说出, inferred=从对话推断'),
  confidence: z
    .number()
    .min(0.1)
    .max(1.0)
    .describe('置信度: explicit=0.9, inferred=0.3~0.5'),
  stability: z
    .enum(['identity', 'state', 'pattern'])
    .describe('稳定性: identity=身份背景(极少变), state=当前状态(经常变), pattern=行为规律(跨场景)'),
})

export interface SaveMemoryToolConfig {
  userId: string
  memoryBaseDir: string
  entrypointLimits?: EntrypointLimits
}

export function createSaveMemoryTool(config: SaveMemoryToolConfig) {
  return tool({
    description: `保存信息到你的持久记忆中。

【何时调用】
- 用户明确表达了个人偏好、身份、背景
- 用户纠正了你的行为，且应长期保持（feedback 类型）
- 用户提到了需要跨会话记住的项目约束或决策
- 用户提到了外部工具、服务、工作流程

【何时不调用】
- 可以从代码、文件、git 历史推导的信息
- 临时性任务信息
- 已经在 THING.md 中描述的内容

【规则】
- 只保存用户明确说出的事实，不要推断
- 如果更新已有记忆，使用 targetFilename 指定目标文件
- 保存前检查已召回的记忆，避免重复`,
    inputSchema: z.object({
      memories: z
        .array(memoryItemSchema)
        .max(5)
        .describe('要保存的记忆列表，每次最多 5 条'),
    }),
    execute: async (input) => {
      const results: Array<{ name: string; action: string; success: boolean; error?: string }> = []

      const userDir = getUserMemoryDir(config.userId, config.memoryBaseDir)
      await ensureMemoryDirExists(userDir)

      // 获取现有记忆用于去重检查
      const existingMemories = await scanMemoryFiles(userDir)

      for (const memory of input.memories.slice(0, 5)) {
        try {
          // 去重检查：同名记忆在 60 秒内已保存则跳过
          const existing = existingMemories.find(
            (m) => m.name === memory.name && m.type === memory.type,
          )
          if (existing && memory.action === 'create') {
            const ageMs = Date.now() - existing.mtimeMs
            if (ageMs < 60_000) {
              results.push({
                name: memory.name,
                action: 'skip',
                success: true,
              })
              continue
            }
          }

          const memoryData: MemoryFileData = {
            name: memory.name,
            description: memory.description,
            type: memory.type as MemoryType,
            content: memory.content,
            source: memory.source,
            confidence: memory.confidence,
            stability: memory.stability,
            subject: memory.subject,
            aliases: memory.aliases,
            context: memory.context,
          }

          if (memory.action === 'create') {
            await writeMemoryFile(userDir, memoryData, memory.content, config.entrypointLimits)
          } else if (memory.action === 'update' && memory.targetFilename) {
            await updateMemoryFile(userDir, memory.targetFilename, memoryData, memory.content, config.entrypointLimits)
          } else if (memory.action === 'delete' && memory.targetFilename) {
            await deleteMemoryWithCleanup(userDir, memory.targetFilename, config.entrypointLimits)
          }

          results.push({
            name: memory.name,
            action: memory.action,
            success: true,
          })
        } catch (err) {
          logger.error('SaveMemory', `Failed to save memory "${memory.name}": ${err}`)
          results.push({
            name: memory.name,
            action: memory.action,
            success: false,
            error: String(err),
          })
        }
      }

      return {
        saved: results.filter((r) => r.success).length,
        skipped: results.filter((r) => r.action === 'skip').length,
        failed: results.filter((r) => !r.success).length,
        results,
      }
    },
  })
}

export type SaveMemoryInput = z.infer<typeof memoryItemSchema>
