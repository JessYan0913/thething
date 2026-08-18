import type { SystemPromptSection } from '../types'
import { MEMORY_GUIDELINES_PROMPT, formatMemoryForPrompt, readAllMemories, rankMemories } from '../../memory'
import { DEFAULT_MEMORY_TOP_K } from '../../../services/config/defaults'
import { logger } from '../../../primitives/logger'

/**
 * 创建用户记忆 guidelines 系统提示词段
 */
export function createMemoryGuidelinesSection(): SystemPromptSection {
  return {
    name: 'memory-guidelines',
    content: MEMORY_GUIDELINES_PROMPT,
    cacheStrategy: 'session',
    priority: 43,
  }
}

/**
 * 创建已召回记忆的系统提示词段（每轮动态注入）
 * 三因子检索：recency×importance×relevance 打分排序，top-k 截断。
 *
 * C1（架构审查）：注入上限由调用方配置决定（memoryTopK），不再硬编码。
 * 记忆量 ≤ 上限时全量注入；仅当超限才截断，且截断时在内容中告知 LLM
 * 总条数与已注入条数——系统只提供可用呈现护栏，把"哪些记忆重要"交给 LLM 判断。
 */
export async function createRecalledMemorySection(
  memoryBaseDir: string,
  query?: string,
  memoryTopK?: number,
): Promise<SystemPromptSection | null> {
  try {
    const all = await readAllMemories(memoryBaseDir)
    if (all.length === 0) return null
    const topK = memoryTopK && memoryTopK > 0 ? memoryTopK : DEFAULT_MEMORY_TOP_K
    const entries = rankMemories(all, { query, topK })
    if (entries.length === 0) return null

    const omitted = all.length - entries.length
    const omissionNote = omitted > 0
      ? `\n\n(共 ${all.length} 条记忆，按评分注入前 ${entries.length} 条；其余 ${omitted} 条未展示。如需，可要求列出更多。)`
      : ''

    return {
      name: 'recalled-memory',
      content: `## 你记住的用户信息\n\n${formatMemoryForPrompt(entries)}${omissionNote}`,
      cacheStrategy: 'dynamic',
      priority: 44,
    }
  } catch (err) {
    logger.warn('MemorySection', `Failed to load memories: ${err}`)
    return null
  }
}
