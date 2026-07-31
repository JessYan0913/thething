import { tool } from 'ai'
import { z } from 'zod'
import { ensureWikiDirExists } from '../wiki/wiki-paths'
import { registerWikiSource } from '../wiki/wiki-sources'
import { wikiActionSchema, wikiSourceSchema } from '../wiki/wiki-prompt'
import { createSaveWikiTool } from './save-wiki'

export interface IngestWikiSourceToolConfig {
  wikiBaseDir: string
}

export function createIngestWikiSourceTool(config: IngestWikiSourceToolConfig) {
  const saveWiki = createSaveWikiTool({ wikiBaseDir: config.wikiBaseDir })

  return tool({
    description: `登记一个原始来源，并把从该来源形成的理解整合到 Wiki。

来源可以只登记引用，也可以同时保存不可变文本快照。没有新的页面变化时 actions 可以为空；系统只登记或去重来源，不会制造无价值页面修订。一次来源也可以创建或更新多个页面，不要求固定页面类型。系统会自动把来源附加到本次所有页面变化，并更新 index.md 和 log.md。`,
    inputSchema: z.object({
      source: wikiSourceSchema.extend({
        content: z
          .string()
          .optional()
          .describe('可选原始文本快照；提供后保存到 raw/snapshots，已有快照不会被覆盖'),
      }),
      actions: z
        .array(wikiActionSchema)
        .max(5)
        .describe('由该来源引起的 Wiki 页面变化；没有页面变化时传空数组，每次最多 5 条'),
    }),
    execute: async (input, options) => {
      await ensureWikiDirExists(config.wikiBaseDir)
      const registration = await registerWikiSource(config.wikiBaseDir, input.source)
      const sourceRef = {
        type: registration.record.type,
        value: registration.record.value,
        revision: registration.record.revision,
        capturedAt: registration.record.capturedAt,
        title: registration.record.title,
      }
      const actions = input.actions.map(action => ({
        ...action,
        origin: 'ingest' as const,
        sources: [sourceRef, ...(action.sources ?? [])],
      }))

      let wikiResult: unknown = {
        saved: 0,
        skipped: 0,
        failed: 0,
        results: [],
      }
      if (actions.length > 0) {
        if (!saveWiki.execute) {
          throw new Error('save_wiki execute handler is unavailable')
        }
        wikiResult = await saveWiki.execute({ actions }, options)
      }

      return {
        source: registration.record,
        sourceCreated: registration.created,
        snapshotCreated: registration.snapshotCreated,
        wiki: wikiResult,
      }
    },
  })
}
