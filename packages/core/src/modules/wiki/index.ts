// ============================================================
// Wiki Module - 基于 LLM Wiki 的知识库系统
// ============================================================

// 路径工具
export { getPrimaryWikiDir, ensureWikiDirExists, pageNameToFilename, filenameToPageName } from './wiki-paths'

// 配置
export { DEFAULT_WIKI_CONFIG, type WikiConfig } from './wiki-config'

// 文件 IO
export {
  formatFrontmatter,
  parsePage,
  readPage,
  readPageRaw,
  writePage,
  updatePage,
  mergePages,
  replacePage,
  invalidatePage,
  deletePage,
  rebuildIndex,
  readIndex,
  parseIndex,
  appendLog,
  readAllPages,
  type WikiPageData,
  type WikiPage,
  type IndexEntry,
  type LogEntry,
} from './wiki-io'

// LLM Prompt + Schema
export {
  LINT_PROMPT,
  WIKI_GUIDELINES_PROMPT,
  wikiActionSchema,
  lintIssueSchema,
  lintOutputSchema,
  type WikiAction,
  type LintIssue,
  type LintOutput,
} from './wiki-prompt'

// Query
export {
  loadWikiContext,
  formatWikiContextForPrompt,
} from './wiki-query'

// Lint
export {
  lintWiki,
  lintDeterministic,
  type LintReport,
} from './wiki-lint'
