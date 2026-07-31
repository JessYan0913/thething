import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writePage, updatePage } from '../../wiki/wiki-io'
import { capturePageRevision } from '../../wiki/wiki-revisions'
import { listPagesForSource } from '../../wiki/wiki-relations'
import { createInspectWikiHistoryTool } from '../inspect-wiki-history'
import { createRestoreWikiRevisionTool } from '../restore-wiki-revision'

async function execute(tool: ReturnType<typeof createInspectWikiHistoryTool> | ReturnType<typeof createRestoreWikiRevisionTool>, input: never) {
  if (!tool.execute) throw new Error('Tool execute handler unavailable')
  return tool.execute(input, { toolCallId: 'test', messages: [], context: undefined as never })
}

describe('wiki history tools', () => {
  it('lists, diffs and restores page revisions', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-history-tool-'))
    const now = new Date().toISOString()
    const oldSource = { type: 'url' as const, value: 'https://example.com/old' }
    const newSource = { type: 'url' as const, value: 'https://example.com/new' }
    const filename = await writePage(wikiDir, {
      name: 'History Tool Page',
      description: 'History tool test',
      category: 'concepts',
      created: now,
      updated: now,
      sources: [oldSource],
    }, 'First version')
    const first = await capturePageRevision(wikiDir, { filename, operation: 'create' })
    await updatePage(wikiDir, filename, 'Second version', 'replace', { sources: [newSource] })
    const second = await capturePageRevision(wikiDir, { filename, operation: 'update' })

    const inspect = createInspectWikiHistoryTool({ wikiBaseDir: wikiDir })
    const listed = await execute(inspect, { action: 'list_revisions', filename } as never) as { revisions: unknown[] }
    expect(listed.revisions).toHaveLength(2)

    const diff = await execute(inspect, {
      action: 'diff',
      filename,
      fromRevisionId: first!.id,
      toRevisionId: second!.id,
    } as never) as { unifiedDiff: string }
    expect(diff.unifiedDiff).toContain('-First version')
    expect(diff.unifiedDiff).toContain('+Second version')

    const restore = createRestoreWikiRevisionTool({ wikiBaseDir: wikiDir })
    const result = await execute(restore, {
      filename,
      revisionId: first!.id,
      reason: 'Test restore',
    } as never) as { restored: boolean; restoredFromRevisionId: string }
    expect(result.restored).toBe(true)
    expect(result.restoredFromRevisionId).toBe(first!.id)
    expect(await listPagesForSource(wikiDir, oldSource)).toHaveLength(1)
    expect(await listPagesForSource(wikiDir, newSource)).toHaveLength(0)

    const after = await execute(inspect, { action: 'list_revisions', filename } as never) as { revisions: unknown[] }
    expect(after.revisions).toHaveLength(3)
  })
})
