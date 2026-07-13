// ============================================================
// Save Wiki Memory Tool - Agent 主动保存知识到 Wiki
// ============================================================

import { tool } from 'ai'
import { z } from 'zod'
import { ensureWikiDirExists } from '../wiki/wiki-paths'
import { writePage, updatePage, mergePages, replacePage, rebuildIndex, appendLog, findFilenameByName, validateCrossReferences, checkContradictions, type WikiPageData } from '../wiki/wiki-io'
import { pageNameToFilename } from '../wiki/wiki-paths'
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from '../wiki/wiki-config'
import { logger } from '../../primitives/logger'
import fs from 'fs/promises'
import path from 'path'

// ============================================================
// Schema
// ============================================================

const wikiActionSchema = z.object({
  action: z
    .enum(['create', 'update', 'merge', 'replace'])
    .describe('操作类型: create=新知识, update=增强已有, merge=合并碎片, replace=替代旧知识'),
  mode: z
    .enum(['replace', 'append'])
    .optional()
    .describe('update 操作的模式: replace=替换旧内容(默认), append=追加到旧内容'),
  category: z
    .enum(['user', 'agent', 'project', 'domain', 'entity'])
    .describe('知识分类: user=用户相关, agent=Agent规则, project=项目知识, domain=领域知识, entity=实体知识'),
  name: z
    .string()
    .max(40)
    .describe('页面名称（简短描述性）'),
  description: z
    .string()
    .max(50)
    .describe('一行摘要（用于索引，不是 content 复述）'),
  content: z
    .string()
    .describe('编译后的知识（AI 未来需要知道的信息，可包含 [[wiki-link]]）'),
  target: z
    .string()
    .optional()
    .describe('目标文件名（可选，update/replace 时如果不提供，会自动根据 name 查找）'),
  mergeTargets: z
    .array(z.string())
    .optional()
    .describe('合并目标文件名列表（merge 时必填）'),
})

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
    description: `保存知识到你的长期知识库（Wiki）。

Wiki 是你跨会话记忆的唯一机制。不保存的知识会永远丢失。

从外部来源获取信息后，必须保存到知识库。

index.md 和 log.md 会自动维护，你只需创建/更新页面。

自动验证：
- 交叉引用验证：检查 content 中的 [[页面名称]] 是否存在，缺失时返回警告
- 矛盾检测：update/replace 时检测新内容与旧内容是否矛盾，矛盾时返回警告

参数说明：
- action: 操作类型（create/update/merge/replace）
- category: 知识分类（user/agent/project/domain/entity）
- name: 页面名称
- description: 一行摘要
- content: 编译后的知识（可包含 [[页面名称]] 引用相关页面，建立知识网络）
- target: 目标文件名（可选，update/replace 时如果不提供，会自动根据 name 查找）`,
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
          const baseData: WikiPageData = {
            name: action.name,
            description: action.description,
            category: action.category,
            created: now,
            updated: now,
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
