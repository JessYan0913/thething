import type { SystemPromptSection } from '../types'
import { MEMORY_GUIDELINES_PROMPT, formatMemoryForPrompt, readAllMemories, rankMemories } from '../../memory'
import { logger } from '../../../primitives/logger'

/** 记忆注入上限：超过后按三因子分数截断，防止塞爆上下文（参考 Claude Code 索引上限） */
const MEMORY_TOP_K = 20

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
 */
export async function createRecalledMemorySection(
  memoryBaseDir: string,
  query?: string,
): Promise<SystemPromptSection | null> {
  try {
    const all = await readAllMemories(memoryBaseDir)
    if (all.length === 0) return null
    const entries = rankMemories(all, { query, topK: MEMORY_TOP_K })
    if (entries.length === 0) return null
    return {
      name: 'recalled-memory',
      content: `## 你记住的用户信息\n\n${formatMemoryForPrompt(entries)}`,
      cacheStrategy: 'dynamic',
      priority: 44,
    }
  } catch (err) {
    logger.warn('MemorySection', `Failed to load memories: ${err}`)
    return null
  }
}
