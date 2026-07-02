// ============================================================
// Wiki Query - Karpathy 模式：LLM 读 index 做语义理解
// ============================================================
// 不做 token 匹配，直接把 index 注入 system prompt，
// 让 Agent 自己理解哪些页面相关。

import fs from 'fs/promises'
import path from 'path'
import { ensureWikiDirExists, pageNameToFilename } from './wiki-paths'
import { parseIndex, readPage, type IndexEntry } from './wiki-io'
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from './wiki-config'

// ============================================================
// 核心函数
// ============================================================

/**
 * 读取 index 和所有页面内容
 * Karpathy 模式：LLM 读 index 理解全貌，按需读取页面
 */
export async function loadWikiContext(
  wikiDir: string,
): Promise<{ indexContent: string; pages: Array<{ name: string; content: string }> }> {
  const config = DEFAULT_WIKI_CONFIG

  await ensureWikiDirExists(wikiDir)

  // 1. 读取 index
  let indexRaw = ''
  try {
    indexRaw = await fs.readFile(path.join(wikiDir, config.indexFile), 'utf-8')
  } catch {
    return { indexContent: '', pages: [] }
  }

  // 2. 读取所有页面内容
  const entries = parseIndex(indexRaw)
  const pages: Array<{ name: string; content: string }> = []

  for (const entry of entries) {
    const filename = pageNameToFilename(entry.name)
    const page = await readPage(wikiDir, filename)
    if (page) {
      pages.push({ name: page.data.name, content: page.content })
    }
  }

  return { indexContent: indexRaw, pages }
}

/**
 * 格式化为系统提示词
 * Karpathy 模式：只注入 index 作为目录，
 * Agent 根据 index 判断哪些页面相关，通过 read_wiki_page 工具按需读取。
 */
export function formatWikiContextForPrompt(
  indexContent: string,
  _pages: Array<{ name: string; content: string }>,
): string {
  if (!indexContent) return ''

  const lines: string[] = ['## 知识库', '']
  lines.push(indexContent)
  return lines.join('\n')
}
