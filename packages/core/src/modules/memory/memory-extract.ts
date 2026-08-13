// ============================================================
// Memory Extract - 冷启动：从历史会话批量提取记忆
// ============================================================
// 用户手动触发（记忆面板按钮）：遍历最近 N 个历史会话，
// 调 LLM 提取关于用户的稳定事实，写入记忆。
// 只提取用户事实，知识/数据/任务分派到对应模块（wiki/ledger/todos）。

import { generateText } from 'ai'
import { z } from 'zod'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { DataStore } from '../../primitives/datastore/types'
import { writeMemory } from './memory-io'
import { logger } from '../../primitives/logger'

// ============================================================
// Schema + Prompt
// ============================================================

const extractionMemorySchema = z.object({
  content: z.string().min(1).max(200).describe('记忆内容，一句话，短且具体'),
  type: z.enum(['preference', 'identity', 'correction', 'explicit']),
  dimension: z.string().optional(),
  importance: z.number().int().min(1).max(10).optional(),
  source: z.string().optional().describe('来源：用户原话或会话上下文'),
})

const extractionOutputSchema = z.object({
  memories: z.array(extractionMemorySchema).max(10),
})

const MEMORY_EXTRACT_PROMPT = `从下面的对话历史中，提取关于用户的稳定事实，作为长期记忆。

【只提取】
- preference：用户的偏好/习惯/喜欢/不喜欢
- identity：身份事实（职业、角色、背景）
- correction：用户对助手行为的纠正（"不要做X"、"以后都用X"），编译成可执行规则
- explicit：用户明确要求记住的内容

【不提取】本通道只写记忆条目，不写 Wiki / Ledger / Todos——以下内容直接丢弃，不要塞进记忆条目：
- 知识、分析、研究结论（属 Wiki）
- 可量化数据、数值、趋势（属 Ledger）
- 任务/项目状态（属 Todos）
- 一次性问答、临时信息、技术实现细节

【规则】
- 每条记忆短、独立、具体
- 单值属性（回复格式、语言）给 dimension；多值属性（食物、兴趣）不给
- importance 1-10：行为纠正和显式记忆更高（7-9），临时偏好更低（3-5）
- source 记录来源（哪句话或哪个话题）
- 只输出 JSON：{"memories": [...]}，无合适内容时输出 {"memories": []}`

// ============================================================
// 会话 → 提取输入文本
// ============================================================

const MAX_USER_MESSAGES = 12
const MAX_MESSAGE_CHARS = 300

/** 从会话消息中提取用户文本消息，拼接为提取输入（忽略工具调用/附件） */
function formatConversationForExtraction(messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }>): string {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role !== 'user') continue
    const texts = (m.parts ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text.trim())
      .filter(Boolean)
    if (texts.length === 0) continue
    const joined = texts.join(' ').slice(0, MAX_MESSAGE_CHARS)
    lines.push(`用户: ${joined}`)
    if (lines.length >= MAX_USER_MESSAGES) break
  }
  return lines.join('\n')
}

// ============================================================
// 提取单会话
// ============================================================

async function extractFromConversation(
  model: LanguageModelV3,
  conversationText: string,
): Promise<z.infer<typeof extractionOutputSchema>['memories']> {
  if (!conversationText.trim()) return []

  const { text } = await generateText({
    model,
    instructions: MEMORY_EXTRACT_PROMPT,
    prompt: conversationText,
    maxOutputTokens: 1500,
  })

  if (!text?.trim()) return []

  // 从响应中提取 JSON 块
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []

  const parsed = extractionOutputSchema.safeParse(JSON.parse(jsonMatch[0]))
  if (!parsed.success) {
    logger.warn('MemoryExtract', `提取输出未通过校验: ${parsed.error.message}`)
    return []
  }
  return parsed.data.memories
}

// ============================================================
// 主入口
// ============================================================

export interface ExtractMemoriesOptions {
  memoryBaseDir: string
  dataStore: DataStore
  model: LanguageModelV3
  /** 最多处理最近 N 个会话（按最近更新排序），默认 10 */
  maxConversations?: number
}

export interface ExtractMemoriesResult {
  extracted: number
  /** 提取到但已存在相同内容的记忆数（跳过） */
  skipped: number
  conversationsScanned: number
}

export async function extractMemoriesFromHistory(
  opts: ExtractMemoriesOptions,
): Promise<ExtractMemoriesResult> {
  const maxConversations = opts.maxConversations ?? 10
  const conversations = opts.dataStore.conversationStore.listConversations()
    .slice(0, maxConversations)

  const existing = new Set<string>()
  const result: ExtractMemoriesResult = { extracted: 0, skipped: 0, conversationsScanned: 0 }

  // 已有记忆用于去重（content 精确匹配）
  const { readAllMemories } = await import('./memory-io')
  for (const entry of await readAllMemories(opts.memoryBaseDir)) {
    existing.add(entry.content)
  }

  for (const conversation of conversations) {
    try {
      const messages = opts.dataStore.messageStore.getMessagesByConversation(conversation.id)
      const conversationText = formatConversationForExtraction(messages)
      if (!conversationText) continue

      result.conversationsScanned++

      const memories = await extractFromConversation(opts.model, conversationText)
      const title = conversation.title || conversation.id

      for (const mem of memories) {
        const content = mem.content.trim()
        if (!content || existing.has(content)) {
          result.skipped++
          continue
        }
        existing.add(content)
        await writeMemory(opts.memoryBaseDir, {
          content,
          type: mem.type,
          dimension: mem.dimension,
          importance: mem.importance,
          source: mem.source ?? `从历史会话「${title}」提取`,
        })
        result.extracted++
      }
    } catch (err) {
      logger.warn('MemoryExtract', `会话 ${conversation.id} 提取失败: ${err}`)
    }
  }

  return result
}
