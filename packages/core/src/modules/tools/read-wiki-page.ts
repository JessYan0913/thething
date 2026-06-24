// ============================================================
// Read Wiki Page Tool - Agent 按需读取 Wiki 页面
// ============================================================

import { tool } from 'ai'
import { z } from 'zod'
import { getUserWikiDir, ensureWikiDirExists, pageNameToFilename } from '../wiki/wiki-paths'
import { readPage } from '../wiki/wiki-io'

// ============================================================
// Tool Config
// ============================================================

export interface ReadWikiPageToolConfig {
  userId: string
  wikiBaseDir: string
}

// ============================================================
// Tool
// ============================================================

export function createReadWikiPageTool(config: ReadWikiPageToolConfig) {
  return tool({
    description: `读取知识库中的指定页面。

【何时调用】
- index.md 中有与当前问题相关的页面，你想了解详细内容
- 需要查看某个页面的完整信息

【用法】
传入页面名称（如 "用户姓名"），返回该页面的完整内容。`,
    inputSchema: z.object({
      pageName: z.string().describe('页面名称（与 index.md 中 [[...]] 内的名称一致）'),
    }),
    execute: async ({ pageName }) => {
      const wikiDir = getUserWikiDir(config.userId, config.wikiBaseDir)
      await ensureWikiDirExists(wikiDir)

      const filename = pageNameToFilename(pageName)
      const page = await readPage(wikiDir, filename)

      if (!page) {
        return { found: false, message: `页面 "${pageName}" 不存在` }
      }

      return {
        found: true,
        name: page.data.name,
        description: page.data.description,
        category: page.data.category,
        content: page.content,
      }
    },
  })
}
