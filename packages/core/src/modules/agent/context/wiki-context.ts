// ============================================================
// Wiki Context - Karpathy 模式：注入 index + 所有页面
// ============================================================

import type { UIMessage } from 'ai'
import { ensureWikiDirExists } from '../../wiki/wiki-paths'
import { loadWikiContext, formatWikiContextForPrompt } from '../../wiki/wiki-query'

export interface WikiContextResult {
  recalledContent: string
}

/**
 * 加载 wiki 知识上下文
 * Karpathy 模式：把 index 和所有页面注入 system prompt，
 * 让 Agent 自己理解哪些知识与当前问题相关。
 */
export async function loadWikiContextForAgent(
  messages: UIMessage[],
  wikiBaseDir: string,
): Promise<WikiContextResult> {
  try {
    const wikiDir = wikiBaseDir
    await ensureWikiDirExists(wikiDir)

    const { indexContent, pages } = await loadWikiContext(wikiDir)

    if (!indexContent && pages.length === 0) {
      return { recalledContent: '' }
    }

    const content = formatWikiContextForPrompt(indexContent, pages)

    return {
      recalledContent: content,
    }
  } catch {
    return { recalledContent: '' }
  }
}
