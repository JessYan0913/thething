// ============================================================
// Wiki Context - 按需读取模式：不预注入 index 全文
// ============================================================
// 为保持 system prompt 前缀静态、利于缓存命中，不再把 index 全文
// （目录）预注入 prompt。模型通过 WIKI_GUIDELINES_PROMPT 与
// read_wiki_page 工具（pageName="index"）按需读取目录与页面。

import type { UIMessage } from 'ai'

export interface WikiContextResult {
  recalledContent: string
}

// 固定字符串：仅告诉模型 wiki 存在与如何获取目录。
// 不随 wiki 内容变化，可稳定占据缓存前缀。
const WIKI_RECALLED_GUIDE = `## 知识库

知识库页面清单见 read_wiki_page 工具（传入 pageName="index" 读取目录），具体页面内容也用 read_wiki_page("页面名") 按需读取。`

/**
 * 加载 wiki 知识上下文（按需读取模式）
 * 只注入固定指引，不预注入 index 全文，让 Agent 通过 read_wiki_page 工具按需读取。
 */
export async function loadWikiContextForAgent(
  _messages: UIMessage[],
  _wikiBaseDir: string,
): Promise<WikiContextResult> {
  return {
    recalledContent: WIKI_RECALLED_GUIDE,
  }
}
