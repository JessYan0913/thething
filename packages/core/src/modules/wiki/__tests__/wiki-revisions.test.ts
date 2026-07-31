import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writePage, updatePage } from '../wiki-io'
import {
  capturePageRevision,
  diffPageRevisions,
  listPageRevisions,
  readPageRevision,
  restorePageRevision,
  initializeWikiRevisionBaselines,
} from '../wiki-revisions'

function data(name: string) {
  const now = new Date().toISOString()
  return { name, description: 'Revision test', category: 'concepts', created: now, updated: now }
}

describe('wiki revisions', () => {
  it('captures immutable revisions and produces a line diff', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-revisions-'))
    const filename = await writePage(wikiDir, data('Revision Page'), '# First\n\nOld line')
    const first = await capturePageRevision(wikiDir, { filename, operation: 'create' })

    await updatePage(wikiDir, filename, '# First\n\nNew line')
    const second = await capturePageRevision(wikiDir, { filename, operation: 'update' })

    expect(first).not.toBeNull()
    expect(second?.parentRevisionId).toBe(first?.id)
    expect(await listPageRevisions(wikiDir, filename)).toHaveLength(2)

    const diff = await diffPageRevisions(wikiDir, {
      filename,
      fromRevisionId: first!.id,
      toRevisionId: second!.id,
    })
    expect(diff.changed).toBe(true)
    expect(diff.unifiedDiff).toContain('-Old line')
    expect(diff.unifiedDiff).toContain('+New line')
  })

  it('restores a revision as a new revision without removing later history', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-revisions-'))
    const filename = await writePage(wikiDir, data('Restore Page'), 'Version one')
    const first = await capturePageRevision(wikiDir, { filename, operation: 'create' })
    await updatePage(wikiDir, filename, 'Version two')
    await capturePageRevision(wikiDir, { filename, operation: 'update' })

    const restored = await restorePageRevision(wikiDir, {
      filename,
      revisionId: first!.id,
      reason: 'Regression detected',
    })

    expect(restored.operation).toBe('restore')
    expect(restored.restoredFromRevisionId).toBe(first!.id)
    expect(await listPageRevisions(wikiDir, filename)).toHaveLength(3)
    expect(await readFile(path.join(wikiDir, filename), 'utf8')).toContain('Version one')
    expect((await readPageRevision(wikiDir, filename, restored.id))?.raw).toContain('Version one')
  })

  it('initializes existing pages with idempotent baseline revisions', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-revisions-'))
    const firstFilename = await writePage(wikiDir, data('Existing One'), 'Existing content')
    const secondFilename = await writePage(wikiDir, data('Existing Two'), 'More existing content')

    expect(await initializeWikiRevisionBaselines(wikiDir)).toHaveLength(2)
    expect(await initializeWikiRevisionBaselines(wikiDir)).toHaveLength(0)
    expect((await listPageRevisions(wikiDir, firstFilename))[0].reason).toBe('baseline')
    expect(await listPageRevisions(wikiDir, secondFilename)).toHaveLength(1)
  })

  it('rejects internal pages and unsafe revision IDs', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-revisions-'))
    await expect(listPageRevisions(wikiDir, '../page.md')).rejects.toThrow('Invalid Wiki page filename')
    await expect(readPageRevision(wikiDir, 'index.md', 'safe')).rejects.toThrow('Invalid Wiki page filename')
    await expect(readPageRevision(wikiDir, 'page.md', '../revision')).rejects.toThrow('Invalid Wiki revision ID')
  })
})
