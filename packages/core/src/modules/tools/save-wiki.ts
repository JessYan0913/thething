// ============================================================
// Save Wiki Memory Tool - Agent 主动保存知识到 Wiki
// ============================================================

import { tool } from 'ai'
import { z } from 'zod'
import { ensureWikiDirExists } from '../wiki/wiki-paths'
import { writePage, updatePage, mergePages, replacePage, invalidatePage, rebuildIndex, appendLog, findFilenameByName, validateCrossReferences, checkContradictions, type WikiPageData } from '../wiki/wiki-io'
import { pageNameToFilename } from '../wiki/wiki-paths'
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from '../wiki/wiki-config'
import { wikiActionSchema } from '../wiki/wiki-prompt'
import { logger } from '../../primitives/logger'
import fs from 'fs/promises'
import path from 'path'

const PROCEDURAL_CONTENT_PATTERNS = [
  /^#{1,6}\s*(安装|配置|使用方法|操作步骤|运行方式|快速开始)/im,
  /(?:^|\n)\s*1[.、]\s*(安装|运行|执行|打开|配置|克隆|下载)/i,
  /(?:npm|pnpm|yarn|pip)\s+(?:install|add)\b/i,
  /git\s+clone\b/i,
]

export function detectProceduralWikiContent(content: string): string[] {
  if (!content) return []
  const matched = PROCEDURAL_CONTENT_PATTERNS.filter(pattern => pattern.test(content)).length
  return matched >= 2
    ? ['内容包含多个安装、配置或操作手册特征；请确认主体是概念知识，命令仅作为解释性证据。']
    : []
}

const INTERNAL_WIKI_PAGES = new Set(['index', 'log'])

function normalizeWikiPageIdentifier(value: string): string {
  return path.basename(value).replace(/\.md$/i, '').toLowerCase()
}

export function validateWikiActionBoundary(action: z.infer<typeof wikiActionSchema>): string | null {
  const referencedPages = [action.name, action.target, ...(action.mergeTargets ?? [])]
    .filter((value): value is string => Boolean(value))

  if (referencedPages.some(value => INTERNAL_WIKI_PAGES.has(normalizeWikiPageIdentifier(value)))) {
    return 'index.md and log.md are maintained internally and cannot be modified by save_wiki'
  }

  if (action.action === 'merge' && action.target && action.mergeTargets) {
    const target = normalizeWikiPageIdentifier(action.target)
    const sources = action.mergeTargets.map(normalizeWikiPageIdentifier)
    if (sources.includes(target)) {
      return 'merge target cannot also appear in mergeTargets'
    }
    if (new Set(sources).size !== sources.length) {
      return 'mergeTargets must not contain duplicate pages'
    }
  }

  return null
}

// ============================================================
// Tool Config
// ============================================================

export interface SaveWikiToolConfig {
  wikiBaseDir: string
  config?: WikiConfig
}

// ============================================================
// Tool
// ============================================================

export function createSaveWikiTool(config: SaveWikiToolConfig) {
  const wikiConfig = config.config || DEFAULT_WIKI_CONFIG

  return tool({
    description: `保存经过筛选的概念性知识到长期知识库（Wiki）。先完成当前任务，再决定是否需要调用本工具。

仅保存以下知识类型：概念、原理、架构、术语关系、稳定机制。内容还应具备稳定性、新颖性、可信度和通用性。

不要仅因为搜索资料、阅读 GitHub 仓库、分析代码或完成一次操作就保存。以下内容不属于 Wiki：
- Skill 的触发条件、执行步骤、工具调用、使用说明
- MCP 或 Connector 配置
- 安装步骤、操作手册、任务日志、临时研究摘录
- 已存在知识的重复表述

用户要求创建或封装 Skill 时，必须实际创建可加载的 SKILL.md；调用本工具不能完成该任务。命令和代码可以作为概念说明的证据，但不能成为页面主体。

每个操作必须通过 knowledgeType 明确所保存的概念知识类型。index.md 和 log.md 会自动维护。`,
    inputSchema: z.object({
      actions: z
        .array(wikiActionSchema)
        .max(5)
        .describe('要执行的操作列表，每次最多 5 条'),
    }),
    execute: async (input) => {
      const results: Array<{
        name: string
        action: string
        success: boolean
        error?: string
        warnings?: string[]
      }> = []

      const wikiDir = config.wikiBaseDir
      await ensureWikiDirExists(wikiDir)

      const now = new Date().toISOString()
      const logDetails: string[] = []

      logger.debug('SaveWiki', `Received ${input.actions.length} actions: ${input.actions.map(a => `${a.action}(${a.name})`).join(', ')}`)

      for (const action of input.actions.slice(0, 5)) {
        try {
          const boundaryError = validateWikiActionBoundary(action)
          if (boundaryError) {
            logger.warn('SaveWiki', `Rejected ${action.action}("${action.name}"): ${boundaryError}`)
            results.push({
              name: action.name,
              action: action.action,
              success: false,
              error: boundaryError,
            })
            continue
          }

          const baseData: WikiPageData = {
            name: action.name,
            description: action.description,
            category: action.category,
            created: now,
            updated: now,
          }

          const warnings = detectProceduralWikiContent(action.content)

          // 交叉引用验证：检查 content 中的 [[页面名称]] 是否存在
          if (action.content) {
            const crossRefResult = await validateCrossReferences(wikiDir, action.content)
            if (!crossRefResult.valid) {
              warnings.push(`交叉引用缺失: ${crossRefResult.missingPages.join(', ')} 不存在`)
              logger.warn('SaveWiki', `Cross reference missing: ${crossRefResult.missingPages.join(', ')}`)
            }
          }

          // 矛盾检测：update/replace 时检查新内容与旧内容是否矛盾
          if ((action.action === 'update' || action.action === 'replace') && action.content) {
            const contradictionResult = await checkContradictions(wikiDir, action.name, action.content)
            if (contradictionResult.hasContradiction) {
              warnings.push(`检测到矛盾: ${contradictionResult.description}`)
              logger.warn('SaveWiki', `Contradiction detected: ${contradictionResult.description}`)
            }
          }

          // 去重检查：同名页面在 60 秒内已创建则跳过
          if (action.action === 'create') {
            const filename = pageNameToFilename(action.name)
            try {
              const existing = await fs.readFile(path.join(wikiDir, filename), 'utf-8')
              const match = existing.match(/^created:\s*(.+)$/m)
              if (match) {
                const createdTime = new Date(match[1].trim()).getTime()
                if (Date.now() - createdTime < 60_000) {
                  results.push({ name: action.name, action: 'skip', success: true })
                  continue
                }
              }
            } catch {
              // 文件不存在，可以创建
            }
          }

          switch (action.action) {
            case 'create': {
              const filename = pageNameToFilename(action.name)
              logger.debug('SaveWiki', `create: name="${action.name}" filename="${filename}"`)
              await writePage(wikiDir, baseData, action.content)
              logDetails.push(`create: [[${action.name}]] — ${action.description}`)
              results.push({ name: action.name, action: action.action, success: true, warnings: warnings.length > 0 ? warnings : undefined })
              break
            }

            case 'update': {
              // 如果 target 不存在，自动根据 name 查找
              let target = action.target
              if (!target) {
                target = await findFilenameByName(wikiDir, action.name) ?? undefined
                if (target) {
                  logger.debug('SaveWiki', `update: auto-found target="${target}" for name="${action.name}"`)
                }
              }

              if (target) {
                const mode = action.mode === 'append' ? 'append' : 'replace'
                logger.debug('SaveWiki', `update: target="${target}" mode="${mode}"`)
                await updatePage(wikiDir, target, action.content, mode)
                logDetails.push(`update: [[${action.name}]] — ${action.description}`)
                results.push({ name: action.name, action: action.action, success: true, warnings: warnings.length > 0 ? warnings : undefined })
              } else {
                logger.warn('SaveWiki', `update action: page "${action.name}" not found, skipping`)
                results.push({ name: action.name, action: action.action, success: false, error: `Page "${action.name}" not found`, warnings: warnings.length > 0 ? warnings : undefined })
              }
              break
            }

            case 'merge':
              if (action.target && action.mergeTargets) {
                await mergePages(wikiDir, action.target, action.mergeTargets)
                logDetails.push(`merge: ${action.mergeTargets.join(', ')} → [[${action.name}]]`)
                results.push({ name: action.name, action: action.action, success: true, warnings: warnings.length > 0 ? warnings : undefined })
              } else {
                results.push({ name: action.name, action: action.action, success: false, error: 'merge requires target and mergeTargets' })
              }
              break

            case 'replace':
              if (action.target) {
                await replacePage(wikiDir, action.target, baseData, action.content)
                logDetails.push(`replace: [[${action.target}]] — ${action.description}`)
                results.push({ name: action.name, action: action.action, success: true, warnings: warnings.length > 0 ? warnings : undefined })
              } else {
                results.push({ name: action.name, action: action.action, success: false, error: 'replace requires target' })
              }
              break

            case 'invalidate': {
              let target = action.target
              if (!target) {
                target = await findFilenameByName(wikiDir, action.name) ?? undefined
              }
              if (target) {
                await invalidatePage(wikiDir, target, action.content)
                logDetails.push(`invalidate: [[${action.name}]] — ${action.description}`)
                results.push({ name: action.name, action: action.action, success: true })
              } else {
                results.push({ name: action.name, action: action.action, success: false, error: `Page "${action.name}" not found` })
              }
              break
            }
          }
        } catch (err) {
          logger.error('SaveWiki', `Failed to save "${action.name}": ${err}`)
          results.push({
            name: action.name,
            action: action.action,
            success: false,
            error: String(err),
          })
        }
      }

      // 重建索引
      await rebuildIndex(wikiDir, wikiConfig)

      // 写入日志
      if (logDetails.length > 0) {
        await appendLog(wikiDir, {
          timestamp: now,
          operation: 'ingest',
          description: `Agent 保存 (${logDetails.length} 条操作)`,
          details: logDetails,
        }, wikiConfig)
      }

      return {
        saved: results.filter(r => r.success).length,
        skipped: results.filter(r => r.action === 'skip').length,
        failed: results.filter(r => !r.success).length,
        results,
      }
    },
  })
}

export type SaveWikiInput = z.infer<typeof wikiActionSchema>
