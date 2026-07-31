import { mkdtemp, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writePage } from '../wiki-io'
import { listPagesForSource, rebuildSourcePageIndex } from '../wiki-relations'
import { createWikiSourceId } from '../wiki-sources'

function page(name: string, sources: Array<{ type: 'url' | 'git'; value: string; revision?: string }>) {
  const now = new Date().toISOString()
  return {
    name,
    description: `${name} description`,
    category: 'concepts',
    created: now,
    updated: now,
    sources,
  }
}

describe('wiki source-page relations', () => {
  it('indexes one source across multiple pages and one page across sources', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-relations-'))
    const source = { type: 'git' as const, value: 'owner/repo', revision: 'abc123' }
    const article = { type: 'url' as const, value: 'https://example.com/article' }
    await writePage(wikiDir, page('Page One', [source, article]), 'One')
    await writePage(wikiDir, page('Page Two', [source]), 'Two')

    const index = await rebuildSourcePageIndex(wikiDir)
    expect(Object.keys(index.sources)).toHaveLength(2)
    expect(index.sources[createWikiSourceId(source)].pages.map(item => item.name)).toEqual(['Page One', 'Page Two'])
    expect(await listPagesForSource(wikiDir, article)).toHaveLength(1)
  })

  it('rebuilds a missing derived index from page frontmatter', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-relations-'))
    const source = { type: 'url' as const, value: 'https://example.com/source' }
    await writePage(wikiDir, page('Rebuild Page', [source]), 'Content')
    await rebuildSourcePageIndex(wikiDir)
    await unlink(path.join(wikiDir, 'system', 'source-pages.json'))

    const relations = await listPagesForSource(wikiDir, createWikiSourceId(source))
    expect(relations.map(item => item.name)).toEqual(['Rebuild Page'])
  })

  it('rejects unsafe source IDs', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-relations-'))
    await expect(listPagesForSource(wikiDir, '../source')).rejects.toThrow('Invalid Wiki source ID')
  })
})
