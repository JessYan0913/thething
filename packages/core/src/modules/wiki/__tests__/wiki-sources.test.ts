import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listWikiSources, registerWikiSource } from '../wiki-sources'

describe('wiki raw sources', () => {
  it('registers a source with an immutable snapshot', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-source-'))
    const result = await registerWikiSource(wikiDir, {
      type: 'url',
      value: 'https://example.com/article',
      title: 'Example article',
      content: '# Original\n\nSource content.',
    })

    expect(result.created).toBe(true)
    expect(result.snapshotCreated).toBe(true)
    expect(result.record.snapshot).toMatch(/^raw\/snapshots\//)
    expect(result.record.contentHash).toHaveLength(64)

    const snapshot = await readFile(path.join(wikiDir, result.record.snapshot!), 'utf8')
    expect(snapshot).toContain('Source content')
  })

  it('deduplicates the same source revision without overwriting its snapshot', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-source-'))
    const first = await registerWikiSource(wikiDir, {
      type: 'git',
      value: 'owner/repo',
      revision: 'abc123',
      content: 'first snapshot',
    })
    const second = await registerWikiSource(wikiDir, {
      type: 'git',
      value: 'owner/repo',
      revision: 'abc123',
      content: 'changed content must not overwrite',
    })

    expect(second.created).toBe(false)
    expect(second.snapshotCreated).toBe(false)
    expect(second.record.id).toBe(first.record.id)

    const snapshot = await readFile(path.join(wikiDir, first.record.snapshot!), 'utf8')
    expect(snapshot).toBe('first snapshot')
    expect(await listWikiSources(wikiDir)).toHaveLength(1)
  })
})
