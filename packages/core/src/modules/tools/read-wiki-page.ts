// ============================================================
// Read Wiki Page Tool - Agent 按需读取 Wiki 页面
// ============================================================

import { tool } from 'ai'
import { z } from 'zod'
import { ensureWikiDirExists, pageNameToFilename } from '../wiki/wiki-paths'
import { readPage, readPageRaw } from '../wiki/wiki-io'

// ============================================================
// Tool Config
// ============================================================

export interface ReadWikiPageToolConfig {
  wikiBaseDir: string
}

// ============================================================
// Tool
// ============================================================

export function createReadWikiPageTool(config: ReadWikiPageToolConfig) {
  return tool({
    description: `读取知识库中的指定页面。

Wiki 是你跨会话记忆的唯一机制。当知识库中有相关信息时，直接使用。

传入页面名称（如 "LLM-基础"），返回该页面的完整内容。传入 "index" 可以读取知识库索引。

如果知识库中没有相关内容，搜索外部来源，整理后必须保存为新页面。`,
    inputSchema: z.object({
      pageName: z.string().describe('页面名称（与 index.md 中 [[...]] 内的名称一致）'),
    }),
    execute: async ({ pageName }) => {
      const wikiDir = config.wikiBaseDir
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
