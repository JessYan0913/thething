// ============================================================
// Lint Wiki Tool - Agent 主动触发知识库健康检查
// ============================================================
// 确定性问题可以自动修复；语义问题只报告建议，
// 由 Agent 综合来源后决定是否 update/merge/invalidate。

import { tool, type LanguageModel } from 'ai'
import { z } from 'zod'
import { ensureWikiDirExists } from '../wiki/wiki-paths'
import { lintWiki } from '../wiki/wiki-lint'
import { readAllPages } from '../wiki/wiki-io'
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from '../wiki/wiki-config'
import { logger } from '../../primitives/logger'

export interface LintWikiToolConfig {
  wikiBaseDir: string
  model?: LanguageModel
  config?: WikiConfig
}

export function createLintWikiTool(config: LintWikiToolConfig) {
  const wikiConfig = config.config || DEFAULT_WIKI_CONFIG

  return tool({
    description: `检查知识库的健康状况，发现矛盾、陈旧信息、孤儿页面、缺失交叉引用和知识空白。

确定性问题（如索引与文件不同步）会自动修复；语义问题（如矛盾或缺失引用）只返回建议，由你根据来源和上下文决定是否修订。

建议在积累了较多来源或页面后定期调用。`,
    inputSchema: z.object({
      semantic: z
        .boolean()
        .optional()
        .describe('是否运行需要模型的语义检查，默认 true；设为 false 时只运行确定性检查'),
    }),
    execute: async (input) => {
      const wikiDir = config.wikiBaseDir
      await ensureWikiDirExists(wikiDir)

      try {
        const useSemantic = input.semantic !== false && Boolean(config.model)
        const report = await lintWiki(
          wikiDir,
          useSemantic ? config.model : undefined,
          wikiConfig,
        )
        const pages = await readAllPages(wikiDir, wikiConfig)
        const semanticIssues = report.issues.filter(
          issue => issue.type === 'contradiction'
            || issue.type === 'missing-crossref'
            || issue.type === 'missing-page',
        )

        logger.debug(
          'LintWiki',
          `Found ${report.issues.length} issues (${semanticIssues.length} semantic), auto-fixed ${report.fixed}`,
        )

        return {
          checked: report.checked,
          totalIssues: report.issues.length,
          autoFixed: report.fixed,
          semanticChecked: useSemantic,
          semanticIssueCount: semanticIssues.length,
          issues: report.issues,
          pages: pages.map(page => ({
            name: page.data.name,
            filename: page.filename,
            category: page.data.category,
            description: page.data.description,
            updated: page.data.updated,
            origin: page.data.origin,
            sourceCount: page.data.sources?.length ?? 0,
          })),
          hint: semanticIssues.length > 0
            ? '语义问题仅作为建议返回。请结合来源和上下文，用 save_wiki 执行 update/merge/invalidate 来修订。'
            : undefined,
        }
      } catch (err) {
        logger.error('LintWiki', `Failed: ${err}`)
        return {
          checked: 0,
          totalIssues: 0,
          autoFixed: 0,
          semanticChecked: false,
          error: String(err),
        }
      }
    },
  })
}
