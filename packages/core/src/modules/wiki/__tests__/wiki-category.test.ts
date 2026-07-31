import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePage, parseIndex, rebuildIndex, writePage } from '../wiki-io'
import { DEFAULT_WIKI_CATEGORY } from '../wiki-config'

describe('wiki category as descriptive grouping', () => {
  it('parses a page without category into the fallback category instead of dropping it', () => {
    const raw = [
      '---',
      'name: Legacy Page',
      'description: Written before category existed',
      'created: 2026-01-01T00:00:00Z',
      'updated: 2026-01-01T00:00:00Z',
      '---',
      'Body content.',
    ].join('\n')

    const page = parsePage(raw, 'legacy-page.md')
    expect(page).not.toBeNull()
    expect(page!.data.category).toBe(DEFAULT_WIKI_CATEGORY)
    expect(page!.data.name).toBe('Legacy Page')
  })

  it('accepts a free-form category outside the suggested set', () => {
    const raw = [
      '---',
      'name: Reading Notes',
      'description: Notes from a book chapter',
      'category: 阅读笔记',
      'created: 2026-01-01T00:00:00Z',
      'updated: 2026-01-01T00:00:00Z',
      '---',
      'Chapter summary.',
    ].join('\n')

    const page = parsePage(raw, 'reading-notes.md')
    expect(page).not.toBeNull()
    expect(page!.data.category).toBe('阅读笔记')
  })

  it('groups the index by categories that actually exist, including custom ones', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const now = new Date().toISOString()

    await writePage(wikiDir, {
      name: 'Domain Page', description: 'Suggested category', category: 'domain', created: now, updated: now,
    }, 'Domain content')
    await writePage(wikiDir, {
      name: 'Custom Page', description: 'Custom category', category: 'comparison', created: now, updated: now,
    }, 'Custom content')

    await rebuildIndex(wikiDir)
    const index = await readFile(path.join(wikiDir, 'index.md'), 'utf8')

    expect(index).toContain('## domain')
    expect(index).toContain('## comparison')
    expect(index).toContain('[[Domain Page]]')
    expect(index).toContain('[[Custom Page]]')
    // 建议分类排在自定义分类前面
    expect(index.indexOf('## domain')).toBeLessThan(index.indexOf('## comparison'))
  })

  it('parses index headers with non-word category names', () => {
    const index = [
      '# index.md',
      '',
      '## 阅读笔记',
      '',
      '- [[Reading Notes]] — Notes from a book chapter',
      '',
    ].join('\n')

    const entries = parseIndex(index)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'Reading Notes', category: '阅读笔记' })
  })
})
