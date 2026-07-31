import { tool } from 'ai'
import { z } from 'zod'
import { appendLog, rebuildIndex } from '../wiki/wiki-io'
import { rebuildSourcePageIndex } from '../wiki/wiki-relations'
import { restorePageRevision } from '../wiki/wiki-revisions'
import { withWikiMutationLock } from '../wiki/wiki-mutation'

export interface RestoreWikiRevisionToolConfig {
  wikiBaseDir: string
}

export function createRestoreWikiRevisionTool(config: RestoreWikiRevisionToolConfig) {
  return tool({
    description: `将指定 Wiki 页面恢复到一个历史修订。恢复是显式操作，会生成新的 restore 修订，不会删除后续历史，并同步重建页面索引与来源关系索引。不要根据 Lint 建议自动恢复。`,
    inputSchema: z.object({
      filename: z.string().min(1).describe('普通 Wiki 页面文件名，必须以 .md 结尾'),
      revisionId: z.string().min(1).describe('要恢复的历史修订 ID'),
      reason: z.string().optional().describe('可选恢复原因'),
    }),
    execute: async (input) => withWikiMutationLock(config.wikiBaseDir, async () => {
      const revision = await restorePageRevision(config.wikiBaseDir, input)
      await rebuildIndex(config.wikiBaseDir)
      await rebuildSourcePageIndex(config.wikiBaseDir)
      await appendLog(config.wikiBaseDir, {
        timestamp: revision.createdAt,
        operation: 'maintenance',
        description: `恢复 Wiki 页面 ${revision.filename}`,
        details: [
          `restore: [[${revision.pageName ?? revision.filename}]] → ${revision.restoredFromRevisionId}`,
          ...(input.reason ? [`reason: ${input.reason}`] : []),
        ],
      })
      return {
        restored: true,
        filename: revision.filename,
        revisionId: revision.id,
        restoredFromRevisionId: revision.restoredFromRevisionId,
      }
    }),
  })
}
