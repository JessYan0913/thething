import { tool } from 'ai'
import { z } from 'zod'
import { diffPageRevisions, listPageRevisions, readPageRevision } from '../wiki/wiki-revisions'
import { listPagesForSource } from '../wiki/wiki-relations'
import { wikiSourceSchema } from '../wiki/wiki-prompt'
import { resolveWikiPageFilenameOrCanonical } from '../wiki/wiki-resolver'

export interface InspectWikiHistoryToolConfig {
  wikiBaseDir: string
}

export function createInspectWikiHistoryTool(config: InspectWikiHistoryToolConfig) {
  return tool({
    description: '查看 Wiki 页面修订历史、读取历史版本、比较版本差异，或查询一个来源影响了哪些页面。该工具只读，不修改 Wiki。',
    inputSchema: z.discriminatedUnion('action', [
      z.object({
        action: z.literal('list_revisions'),
        filename: z.string().min(1),
      }),
      z.object({
        action: z.literal('read_revision'),
        filename: z.string().min(1),
        revisionId: z.string().min(1),
      }),
      z.object({
        action: z.literal('diff'),
        filename: z.string().min(1),
        fromRevisionId: z.string().optional(),
        toRevisionId: z.string().optional(),
      }).refine(input => input.fromRevisionId || input.toRevisionId, {
        message: '至少提供一个 revision ID，未提供的一侧表示当前页面',
      }),
      z.object({
        action: z.literal('source_pages'),
        sourceId: z.string().optional(),
        source: wikiSourceSchema.optional(),
      }).refine(input => input.sourceId || input.source, {
        message: '提供 sourceId 或 source',
      }),
    ]),
    execute: async (input) => {
      switch (input.action) {
        case 'list_revisions': {
          const filename = await resolveWikiPageFilenameOrCanonical(config.wikiBaseDir, input.filename)
          return { revisions: await listPageRevisions(config.wikiBaseDir, filename) }
        }
        case 'read_revision': {
          const filename = await resolveWikiPageFilenameOrCanonical(config.wikiBaseDir, input.filename)
          const snapshot = await readPageRevision(config.wikiBaseDir, filename, input.revisionId)
          if (!snapshot) throw new Error(`Wiki revision not found: ${input.revisionId}`)
          return snapshot
        }
        case 'diff': {
          const filename = await resolveWikiPageFilenameOrCanonical(config.wikiBaseDir, input.filename)
          return diffPageRevisions(config.wikiBaseDir, { ...input, filename })
        }
        case 'source_pages':
          return {
            pages: await listPagesForSource(config.wikiBaseDir, input.sourceId ?? input.source!),
          }
      }
    },
  })
}
