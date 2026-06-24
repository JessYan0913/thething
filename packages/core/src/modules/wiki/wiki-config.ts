// ============================================================
// Wiki Config - 知识库配置
// ============================================================

export interface WikiConfig {
  /** 索引文件名 */
  indexFile: string
  /** 日志文件名 */
  logFile: string
  /** 知识分类 */
  categories: string[]
  /** Lint 触发间隔（对话次数） */
  lintInterval: number
  /** 过期阈值（天） */
  staleThresholdDays: number
  /** 最大页面数 */
  maxPages: number
  /** 每次 ingest 最大操作数 */
  maxActionsPerIngest: number
  /** Query 最大召回数 */
  maxRecallResults: number
}

export const DEFAULT_WIKI_CONFIG: WikiConfig = {
  indexFile: 'index.md',
  logFile: 'log.md',
  categories: ['user', 'agent', 'project', 'domain', 'entity'],
  lintInterval: 10,
  staleThresholdDays: 90,
  maxPages: 200,
  maxActionsPerIngest: 5,
  maxRecallResults: 5,
}
