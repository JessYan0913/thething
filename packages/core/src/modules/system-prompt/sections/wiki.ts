import type { SystemPromptSection } from '../types'
import { getUserWikiDir, directoryExists } from '../../wiki/wiki-paths'
import { WIKI_GUIDELINES_PROMPT } from '../../wiki/wiki-prompt'
import { logger } from '../../../primitives/logger'

/**
 * 创建知识库管理 guidelines 系统提示词段
 * 失败时静默返回 null，不阻塞系统提示词构建
 */
export async function createWikiGuidelinesSection(
  userId?: string,
  memoryBaseDir?: string,
): Promise<SystemPromptSection | null> {
  try {
    if (!userId || !memoryBaseDir) {
      return null
    }

    const wikiDir = getUserWikiDir(userId, memoryBaseDir)

    if (!(await directoryExists(wikiDir))) {
      return null
    }

    return {
      name: 'wiki-guidelines',
      content: WIKI_GUIDELINES_PROMPT,
      cacheStrategy: 'session',
      priority: 45,
    }
  } catch (err) {
    logger.warn('WikiSection', `Failed to create wiki guidelines section: ${err}`)
    return null
  }
}

/**
 * 创建召回知识系统提示词段
 */
export async function createRecalledWikiSection(
  recalledContent: string,
): Promise<SystemPromptSection | null> {
  if (!recalledContent) {
    return null
  }

  return {
    name: 'recalled-wiki',
    content: recalledContent,
    cacheStrategy: 'dynamic',
    priority: 46,
  }
}
