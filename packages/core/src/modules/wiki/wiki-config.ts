// ============================================================
// Wiki Config - 知识库配置
// ============================================================

export interface WikiConfig {
  /** 索引文件名 */
  indexFile: string
  /** 日志文件名 */
  logFile: string
  /** 索引分组的优先排序；未列出的分类按实际内容动态追加 */
  categories: string[]
  /** Lint 触发间隔（对话次数） */
  lintInterval: number
  /** 过期阈值（天） */
  staleThresholdDays: number
  /** 最大页面数 */
  maxPages: number
  /** 每次 ingest 最大操作数 */
  maxActionsPerIngest: number
}

/** 页面缺失 category 时的兜底分类 */
export const DEFAULT_WIKI_CATEGORY = 'misc'

export const DEFAULT_WIKI_CONFIG: WikiConfig = {
  indexFile: 'index.md',
  logFile: 'log.md',
  categories: ['user', 'agent', 'project', 'domain', 'entity'],
  lintInterval: 10,
  staleThresholdDays: 90,
  maxPages: 200,
  maxActionsPerIngest: 5,
}
