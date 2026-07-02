// ============================================================
// Save Wiki Memory Tool - Agent 主动保存知识到 Wiki
// ============================================================

import { tool } from 'ai'
import { z } from 'zod'
import { ensureWikiDirExists } from '../wiki/wiki-paths'
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

Wiki 是一个持久化的知识工件——你跨会话记忆的唯一机制。不保存的知识会永远丢失。

【核心理念（来自 Karpathy）】
Wiki 是持久的、复合的知识工件。你增量地构建和维护它——结构化的、相互链接的 markdown 文件。当添加新来源时，你将其整合到现有 wiki 中，更新实体页、修订摘要、标注矛盾。

"知识库的繁琐部分不是阅读或思考——而是簿记。" LLM 处理交叉引用、一致性和多文件更新的成本几乎为零。

【重要：自动处理】
- **index.md 会自动重建**：每次保存后，会扫描所有页面并重建索引
- **log.md 会自动追加**：每次保存后，会记录操作到日志
- **你只需要创建/更新页面，不需要手动管理索引和日志**

【Ingest操作】
当用户发送URL并说"学习"、"阅读"、"看一下"等时，这是Ingest操作：
1. 先获取URL内容
2. 整理要点后回答用户
3. 调用save_wiki保存：
   - 创建摘要页面（**只创建页面，index.md和log.md会自动更新**）
   - 仅在新信息实质性改变已有页面时才更新它们

【Ingest的核心：交叉引用】
每次 Ingest 创建新页面时：

1. 读 index，检查现有页面列表
2. 创建新页面时，在正文内容中用 [[页面名称]] 自然地引用相关已有页面（新页面引用旧页面，提供上下文归属）
3. 仅在新来源为已有页面提供了新事实、新数据或矛盾信息时，才用 update 操作更新该页面。不要仅仅因为新页面引用了旧页面就更新旧页面。
4. 如果新信息与已有页面冲突，在两个页面中都标注矛盾

**链接方向规则：**
- ✅ 新页面正文中引用已有页面（自下而上，由专到泛）
- ✅ 已有页面仅在获得新信息时被更新
- ❌ 不要仅仅因为新页面引用了旧页面就往旧页面追加内容
- ❌ 不要在旧页面末尾追加新页面的摘要（这会膨胀旧页面）
- ❌ 不要创建"相关页面"部分（链接应在正文中自然体现）

【其他保存场景】
- 用户明确的信息：偏好、习惯、身份
- 行为纠正：用户指出的规则或偏好
- 技术对比：你做的对比分析、架构决策
- 研究发现：论文洞察、最佳实践
- 综合判断：跨多个来源的分析

【Content 编译规则】
- content 写的是"AI 未来需要知道什么"，不是"用户说了什么"
- 直接事实 → 事实本身
- 行为纠正 → 编译后的规则
- 技术对比 → 结论 + 原因
- 架构决策 → 决策 + 理由`,
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
