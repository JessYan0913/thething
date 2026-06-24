// ============================================================
// Read Wiki Page Tool - Agent 按需读取 Wiki 页面
// ============================================================

import { tool } from 'ai'
import { z } from 'zod'
import { getUserWikiDir, ensureWikiDirExists, pageNameToFilename } from '../wiki/wiki-paths'
import { readPage, readPageRaw } from '../wiki/wiki-io'

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
    description: `读取知识库中的指定页面（Query操作）。

Wiki 是一个持久化的知识工件——你跨会话记忆的唯一机制。当知识库中有相关信息时，直接使用，不要犹豫。

【Query操作】
基于 wiki 提问。你搜索相关页面，综合回答并引用。好的回答可以作为新 wiki 页面存入，让探索像摄入来源一样复合增长。

【何时调用】
- 用户提问时，index.md 中有相关页面
- 需要查看某个页面的详细内容
- 需要综合多个页面的信息来回答

【用法】
传入页面名称（如 "LLM-基础"），返回该页面的完整内容。传入 "index" 可以读取知识库索引。

【Query操作流程】
1. 先检查 index.md，找到相关页面
2. 调用本工具读取相关页面
3. 综合信息回答用户，并引用来源
4. 如果产生了有价值的结论，可以调用 save_wiki 保存为新页面`,
    inputSchema: z.object({
      pageName: z.string().describe('页面名称（与 index.md 中 [[...]] 内的名称一致）'),
    }),
    execute: async ({ pageName }) => {
      const wikiDir = getUserWikiDir(config.userId, config.wikiBaseDir)
      await ensureWikiDirExists(wikiDir)

      const filename = pageNameToFilename(pageName)

      // 特殊处理：读取 index.md（没有 frontmatter）
      if (pageName === 'index' || pageName === 'index.md') {
        const content = await readPageRaw(wikiDir, 'index.md')
        if (content) {
          return {
            found: true,
            name: 'index',
            description: '知识库索引',
            category: 'agent',
            content: content,
          }
        }
        return { found: false, message: '索引页面不存在' }
      }

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
