// ============================================================
// Wiki Module - 基于 LLM Wiki 的知识库系统
// ============================================================

// 路径工具
export { getPrimaryWikiDir, ensureWikiDirExists, pageNameToFilename, filenameToPageName } from './wiki-paths'

// 配置
export { DEFAULT_WIKI_CONFIG, DEFAULT_WIKI_CATEGORY, type WikiConfig } from './wiki-config'

// 文件 IO
export {
  formatFrontmatter,
  parsePage,
  readPage,
  readPageRaw,
  atomicWriteText,
  writePage,
  updatePage,
  mergePages,
  replacePage,
  moveAndReplacePage,
  invalidatePage,
  deletePage,
  rebuildIndex,
  readIndex,
  parseIndex,
  appendLog,
  readAllPages,
  scanPageFiles,
  migrateWikiToDirectories,
  type WikiPageData,
  type WikiSourceData,
  type WikiPage,
  type IndexEntry,
  type LogEntry,
} from './wiki-io'

// LLM Prompt + Schema
export {
  LINT_PROMPT,
  WIKI_GUIDELINES_PROMPT,
  wikiActionSchema,
  wikiSourceSchema,
  lintIssueSchema,
  lintOutputSchema,
  type WikiAction,
  type WikiSource,
  type LintIssue,
  type LintOutput,
} from './wiki-prompt'

// Raw sources
export {
  createWikiSourceId,
  registerWikiSource,
  listWikiSources,
  type WikiSourceRecord,
  type RegisterWikiSourceInput,
  type RegisterWikiSourceResult,
} from './wiki-sources'

// Source-page relations
export {
  rebuildSourcePageIndex,
  readSourcePageIndex,
  listPagesForSource,
  type WikiSourcePageIndex,
  type WikiSourcePageRelation,
} from './wiki-relations'

// Git version control
export { ensureWikiGitRepo, commitWiki } from './git-vcs'

// Mutation serialization
export { withWikiMutationLock, clearWikiMutationLocks } from './wiki-mutation'

// Query
export {
  loadWikiContext,
  formatWikiContextForPrompt,
} from './wiki-query'

// Maintenance
export {
  getWikiLintStatus,
  type WikiLintStatus,
} from './wiki-maintenance'

// Lint
export {
  lintWiki,
  lintDeterministic,
  type LintReport,
} from './wiki-lint'
