// ============================================================
// Save Wiki Memory Tool - Agent 主动保存知识到 Wiki
// ============================================================

import { tool } from 'ai'
import { z } from 'zod'
import { getUserWikiDir, ensureWikiDirExists } from '../wiki/wiki-paths'
import { writePage, updatePage, mergePages, replacePage, rebuildIndex, appendLog, type WikiPageData } from '../wiki/wiki-io'
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
    .describe('目标文件名（update/merge/replace 时必填）'),
  mergeTargets: z
    .array(z.string())
    .optional()
    .describe('合并目标文件名列表（merge 时必填）'),
})

// ============================================================
// Tool Config
// ============================================================

export interface SaveWikiToolConfig {
  userId: string
  wikiBaseDir: string
  config?: WikiConfig
}

// ============================================================
// Tool
// ============================================================

export function createSaveWikiTool(config: SaveWikiToolConfig) {
  const wikiConfig = config.config || DEFAULT_WIKI_CONFIG

  return tool({
    description: `将对话中的知识编译并保存到知识库。

【何时调用】
- 用户说出了关于自己的事实（偏好、身份、习惯）
- 用户纠正了你的行为，且应长期保持
- 你在对话中产生了有价值的综合分析或对比结论
- 沉淀了架构决策或技术选型的理由
- 总结了研究发现或最佳实践
- 建立了对某个工具/服务/人物的认知
- 用户提到需要跨会话记住的约束或决策

【何时不调用】
- 可以从代码、文件、git 历史推导的信息
- 临时性任务信息
- 用户只是表达了即时情绪

【Content 编译规则】
- 直接事实 → content = 事实本身
- 间接指令 → content = 推导结论
- 行为纠正 → content = 编译后的规则
- 技术对比 → content = 结论（"在Y场景下，X优于Z，因为..."）
- 架构决策 → content = 决策 + 理由
- 研究发现 → content = 洞察（不是原文转述）

【规则】
- content 存储的是 AI 未来需要知道的信息，不是用户说了什么
- 增强优先于创建：新信息与已有知识相关时，使用 update
- 如果更新已有记忆，使用 target 指定目标文件名
- content 中可以使用 [[wiki-link]] 建立交叉引用`,
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
      }> = []

      const wikiDir = getUserWikiDir(config.userId, config.wikiBaseDir)
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
              break
            }

            case 'update': {
              logger.debug('SaveWiki', `update: target="${action.target}" mode="${action.mode || 'replace'}"`)
              if (action.target) {
                const mode = action.mode === 'append' ? 'append' : 'replace'
                await updatePage(wikiDir, action.target, action.content, mode)
                logDetails.push(`update: [[${action.target}]] — ${action.description}`)
              } else {
                logger.warn('SaveWiki', `update action missing target! action=${JSON.stringify(action)}`)
              }
              break
            }

            case 'merge':
              if (action.target && action.mergeTargets) {
                await mergePages(wikiDir, action.target, action.mergeTargets)
                logDetails.push(`merge: ${action.mergeTargets.join(', ')} → [[${action.name}]]`)
              }
              break

            case 'replace':
              if (action.target) {
                await replacePage(wikiDir, action.target, baseData, action.content)
                logDetails.push(`replace: [[${action.target}]] — ${action.description}`)
              }
              break
          }

          results.push({ name: action.name, action: action.action, success: true })
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
