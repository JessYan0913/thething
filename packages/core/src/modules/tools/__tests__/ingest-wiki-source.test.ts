import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createIngestWikiSourceTool } from '../ingest-wiki-source'

async function execute(tool: any, input: unknown): Promise<any> {
  return tool.execute(input, { toolCallId: 'test', messages: [] })
}

describe('ingest_wiki_source tool', () => {
  it('registers one source and attaches it to all page changes', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-ingest-'))
    const tool = createIngestWikiSourceTool({ wikiBaseDir })

    const result = await execute(tool, {
      source: {
        type: 'git',
        value: 'owner/repo',
        revision: 'abc123',
        content: '# Repository notes',
      },
      actions: [
        {
          action: 'create',
          category: 'project',
          name: 'Repository architecture',
          description: 'Architecture synthesized from repository',
          content: 'The repository uses layered modules.',
        },
        {
          action: 'create',
          category: 'domain',
          name: 'Repository workflow',
          description: 'Workflow synthesized from repository',
          content: 'Changes pass through validation before release.',
        },
      ],
    })

    expect(result.sourceCreated).toBe(true)
    expect(result.snapshotCreated).toBe(true)
    expect(result.wiki.saved).toBe(2)

    for (const filename of ['project/repository-architecture.md', 'domain/repository-workflow.md']) {
      const page = await readFile(path.join(wikiBaseDir, filename), 'utf8')
      expect(page).toContain('origin: ingest')
      expect(page).toContain('owner/repo')
      expect(page).toContain('abc123')
    }

    const registry = await readFile(path.join(wikiBaseDir, 'raw', 'sources.jsonl'), 'utf8')
    expect(registry.trim().split('\n')).toHaveLength(1)
  })

  it('registers and deduplicates a source without forcing page actions', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-ingest-'))
    const tool = createIngestWikiSourceTool({ wikiBaseDir })
    const input = {
      source: {
        type: 'url',
        value: 'https://example.com/source',
        revision: 'v1',
        content: '# Immutable source snapshot',
      },
      actions: [],
    }

    const first = await execute(tool, input)
    const second = await execute(tool, input)

    expect(first).toMatchObject({
      sourceCreated: true,
      snapshotCreated: true,
      wiki: { saved: 0, skipped: 0, failed: 0, results: [] },
    })
    expect(second).toMatchObject({
      sourceCreated: false,
      snapshotCreated: false,
      wiki: { saved: 0, skipped: 0, failed: 0, results: [] },
    })

    const registry = await readFile(path.join(wikiBaseDir, 'raw', 'sources.jsonl'), 'utf8')
    expect(registry.trim().split('\n')).toHaveLength(1)
    expect(await readdir(wikiBaseDir)).toEqual(['raw'])
    expect(await readdir(path.join(wikiBaseDir, 'raw', 'snapshots'))).toHaveLength(1)
  })
})
