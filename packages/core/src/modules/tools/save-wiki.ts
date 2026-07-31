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
    description: `将有价值的理解整合到持久化 Wiki。Wiki 是由 Agent 持续维护的复利知识工件，可以包含来源摘要、实体、概念、事件、步骤、比较、项目知识和不断演化的综合分析。

写入前先查看已有页面，优先更新、合并和建立交叉引用，避免机械创建重复内容。新信息与旧结论冲突时，应保留来源上下文并修订综合判断。查询中产生的有价值分析和联系也可以保存。

不要求内容预先归入固定知识类型，也不必等到完全稳定或结构完美才记录；后续可通过新的来源、查询和 lint 持续修正。index.md 和 log.md 会自动维护。`,
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

          const origin = action.origin ?? 'ingest'
          const baseData: WikiPageData = {
            name: action.name,
            description: action.description,
            category: action.category,
            created: now,
            updated: now,
            origin,
            sources: action.sources,
          }

          const warnings: string[] = []

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
                await updatePage(wikiDir, target, action.content, mode, { origin, sources: action.sources })
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
                await mergePages(wikiDir, action.target, action.mergeTargets, { origin, sources: action.sources })
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
                await invalidatePage(wikiDir, target, action.content, { origin, sources: action.sources })
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
        const origins = new Set(input.actions.map(a => a.origin ?? 'ingest'))
        const logOperation = origins.size === 1
          ? (input.actions[0].origin ?? 'ingest')
          : 'ingest'
        await appendLog(wikiDir, {
          timestamp: now,
          operation: logOperation,
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
