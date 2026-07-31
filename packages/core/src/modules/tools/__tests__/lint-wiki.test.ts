import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLintWikiTool } from '../lint-wiki'
import { writePage } from '../../wiki/wiki-io'

async function execute(tool: any, input: unknown): Promise<any> {
  return tool.execute(input, { toolCallId: 'test', messages: [] })
}

describe('lint_wiki tool', () => {
  it('runs deterministic lint and repairs a missing index entry', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-lint-'))
    const now = new Date().toISOString()

    await writePage(wikiBaseDir, {
      name: 'Unindexed page',
      description: 'A page not yet listed in index',
      category: 'domain',
      created: now,
      updated: now,
      origin: 'ingest',
      sources: [{ type: 'url', value: 'https://example.com/source' }],
    }, 'Some knowledge.')
    await writeFile(path.join(wikiBaseDir, 'index.md'), '# index.md\n', 'utf8')

    const tool = createLintWikiTool({ wikiBaseDir })
    const result = await execute(tool, { semantic: false })

    expect(result.checked).toBe(1)
    expect(result.semanticChecked).toBe(false)
    expect(result.autoFixed).toBeGreaterThanOrEqual(1)
    expect(result.pages[0].sourceCount).toBe(1)

    const index = await readFile(path.join(wikiBaseDir, 'index.md'), 'utf8')
    expect(index).toContain('[[Unindexed page]]')

    const log = await readFile(path.join(wikiBaseDir, 'log.md'), 'utf8')
    expect(log).toContain('lint')
  })

  it('does not require a model for deterministic lint', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-lint-'))
    const tool = createLintWikiTool({ wikiBaseDir })

    const result = await execute(tool, {})

    expect(result.semanticChecked).toBe(false)
    expect(result.error).toBeUndefined()
  })
})
