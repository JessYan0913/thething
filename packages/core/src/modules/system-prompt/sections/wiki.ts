import type { SystemPromptSection } from '../types'
import { WIKI_GUIDELINES_PROMPT } from '../../wiki/wiki-prompt'
import { logger } from '../../../primitives/logger'

/**
 * 创建知识库管理 guidelines 系统提示词段
 * 失败时静默返回 null，不阻塞系统提示词构建
 */
export async function createWikiGuidelinesSection(
  userId?: string,
  wikiBaseDir?: string,
): Promise<SystemPromptSection | null> {
  try {
    if (!userId || !wikiBaseDir) {
      return null
    }

    // wiki 目录不存在时仍然注入 prompt——AI 需要知道可以第一次保存
    // save_wiki 工具会自动创建目录

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
