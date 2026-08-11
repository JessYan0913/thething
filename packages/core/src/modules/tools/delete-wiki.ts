// ============================================================
// Delete Wiki Page Tool - Agent 删除知识库页面
// ============================================================
// 删除是不可逆操作：物理移除文件。宿主 git 已记录删除前版本，
// 可通过 git log / git checkout 手动恢复。优先推荐 invalidate 作为替代。

import { tool } from 'ai'
import { z } from 'zod'
import path from 'path'
import { appendLog, deletePage, rebuildIndex } from '../wiki/wiki-io'
import { rebuildSourcePageIndex } from '../wiki/wiki-relations'
import { commitWiki, ensureWikiGitRepo } from '../wiki/git-vcs'
import { withWikiMutationLock } from '../wiki/wiki-mutation'
import { resolveWikiPageFilename } from '../wiki/wiki-resolver'

export interface DeleteWikiToolConfig {
  wikiBaseDir: string
}

// 系统内部维护的文件，禁止通过工具删除
const INTERNAL_WIKI_FILENAMES = new Set(['index.md', 'log.md'])

export function createDeleteWikiTool(config: DeleteWikiToolConfig) {
  return tool({
    description: `删除知识库中的指定页面。删除是不可逆操作：页面文件从知识库移除（宿主 git 保留了删除前版本，可通过 git log / git checkout 手动恢复）。

优先考虑替代方案，避免误删：
- 页面信息仍有效但只是不再重要 → 不删除，保留即可
- 页面信息已过时但可能仍有历史价值 → 用 save_wiki 的 invalidate 标记过期（更安全）
- 页面信息确实错误或完全无用，确认不再需要 → 才用本工具删除

删除前必须给出明确理由。index.md 和 log.md 由系统维护，不可删除。`,
    inputSchema: z.object({
      target: z.string().min(1).describe('要删除的页面名称或文件名（与 index 中的 [[...]] 或实际文件名一致，支持 category/name 形式）'),
      reason: z.string().min(1).describe('删除原因（必须说明，用于日志追溯）'),
    }),
    execute: async (input) => withWikiMutationLock(config.wikiBaseDir, async () => {
      const wikiDir = config.wikiBaseDir
      // 写入前初始化 git，保证删除前基线已存在（删除后可通过 git 历史恢复）
      await ensureWikiGitRepo(wikiDir)

      const filename = await resolveWikiPageFilename(wikiDir, input.target)
      if (!filename) {
        return { deleted: false, error: `Wiki 页面 "${input.target}" 不存在` }
      }
      if (INTERNAL_WIKI_FILENAMES.has(path.basename(filename))) {
        return { deleted: false, error: 'index.md 和 log.md 由系统维护，不可删除' }
      }

      const now = new Date().toISOString()
      await deletePage(wikiDir, filename)
      await rebuildIndex(wikiDir)
      await rebuildSourcePageIndex(wikiDir)
      await appendLog(wikiDir, {
        timestamp: now,
        operation: 'maintenance',
        description: `删除 Wiki 页面 ${filename}`,
        details: [
          `delete: [[${input.target}]]`,
          `reason: ${input.reason}`,
        ],
      })

      await commitWiki(wikiDir, `delete: ${filename}`)

      return { deleted: true, filename, reason: input.reason }
    }),
  })
}
