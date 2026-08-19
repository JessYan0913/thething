import type { SystemPromptSection } from '../types'
import { WIKI_GUIDELINES_PROMPT } from '../../wiki/wiki-prompt'
import { getWikiLintStatus } from '../../wiki/wiki-maintenance'
import { logger } from '../../../primitives/logger'

/**
 * 创建知识库管理 guidelines 系统提示词段
 * 失败时静默返回 null，不阻塞系统提示词构建
 */
export async function createWikiGuidelinesSection(
  wikiBaseDir?: string,
): Promise<SystemPromptSection | null> {
  try {
    if (!wikiBaseDir) {
      return null
    }

    // wiki 目录不存在时仍然注入 prompt——AI 需要知道可以第一次保存。
    // lint 到期只追加非强制提示，不自动执行，也不打断当前任务。
    const lintStatus = await getWikiLintStatus(wikiBaseDir)
    const lintReminder = lintStatus.due
      ? `\n\n### 维护提醒\n\nWiki 自上次 Lint 后已有 ${lintStatus.changesSinceLastLint} 次变化。当前任务完成后，如有必要可调用 lint_wiki 进行健康检查；不要为了检查而打断当前任务。`
      : ''

    return {
      name: 'wiki-guidelines',
      content: WIKI_GUIDELINES_PROMPT + lintReminder,
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
    // 撤回内容为固定指引字符串（不读任何动态输入），安全排入缓存前缀区。
    // priority < DYNAMIC_BOUNDARY_PRIORITY (50)，排序后位于边界之前，参与稳定缓存。
    cacheStrategy: 'session',
    priority: 46,
  }
}
