// ============================================================
// Wiki Module - 基于 LLM Wiki 的知识库系统
// ============================================================

// 路径工具
export { getPrimaryMemoryDir, getUserWikiDir, ensureWikiDirExists, pageNameToFilename, filenameToPageName } from './wiki-paths'

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
  WIKI_MAINTAINER_PROMPT,
  LINT_PROMPT,
  WIKI_GUIDELINES_PROMPT,
  wikiActionSchema,
  wikiIngestSchema,
  lintIssueSchema,
  lintOutputSchema,
  type WikiAction,
  type WikiIngestOutput,
  type LintIssue,
  type LintOutput,
} from './wiki-prompt'

// Ingest
export {
  ingestWikiFromConversation,
  ingestWikiInBackground,
  executeWikiAction,
  type WikiIngestResult,
} from './wiki-ingest'

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
