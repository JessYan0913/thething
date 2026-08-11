import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSaveWikiTool, validateWikiActionBoundary } from '../save-wiki'

async function execute(tool: any, input: unknown): Promise<any> {
  return tool.execute(input, { toolCallId: 'test', messages: [] })
}

describe('save_wiki integrity boundaries', () => {
  it('rejects direct operations on internally maintained pages', () => {
    expect(validateWikiActionBoundary({
      action: 'update',
      category: 'domain',
      name: 'index',
      target: 'index.md',
      description: 'Manual index update',
      content: 'Do not persist this.',
    })).toContain('maintained internally')
  })

  it('rejects self-merge and duplicate merge sources', () => {
    expect(validateWikiActionBoundary({
      action: 'merge',
      category: 'domain',
      name: 'HyperFrames overview',
      target: 'hyperframes-overview.md',
      mergeTargets: ['hyperframes-overview'],
      description: 'Invalid self merge',
      content: '',
    })).toContain('cannot also appear')

    expect(validateWikiActionBoundary({
      action: 'merge',
      category: 'domain',
      name: 'HyperFrames overview',
      target: 'hyperframes-overview.md',
      mergeTargets: ['rendering.md', 'rendering'],
      description: 'Invalid duplicate sources',
      content: '',
    })).toContain('duplicate')
  })

  it('does not modify index when an internal-page action is rejected', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })
    const result = await execute(tool, {
      actions: [{
        action: 'create',
        category: 'domain',
        name: 'index',
        description: 'Attempted replacement',
        content: 'malicious index content',
      }],
    })

    expect(result.failed).toBe(1)
    expect(result.results[0].error).toContain('maintained internally')
    expect(await readFile(path.join(wikiBaseDir, 'index.md'), 'utf8')).not.toContain('malicious index content')
  })

  it('accepts different useful page forms without a fixed knowledge type', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })

    const result = await execute(tool, {
      actions: [{
        action: 'create',
        category: 'project',
        name: 'Local development workflow',
        description: 'Working notes for developing the project locally',
        content: '## Setup\n1. Install dependencies.\n2. Run the local checks.\n\nUpdate this page as the workflow evolves.',
      }],
    })

    expect(result.saved).toBe(1)
    expect(result.results[0].warnings).toBeUndefined()
    expect(await readFile(path.join(wikiBaseDir, 'project/local-development-workflow.md'), 'utf8')).toContain('Local development workflow')
  })

  it('saves pages with a custom category or no category at all', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })

    const result = await execute(tool, {
      actions: [
        {
          action: 'create',
          category: 'comparison',
          name: 'Framework comparison',
          description: 'A comparison that fits no suggested category',
          content: 'Option A vs Option B.',
        },
        {
          action: 'create',
          name: 'Uncategorized note',
          description: 'Saved without any category',
          content: 'Still worth keeping.',
        },
      ],
    })

    expect(result.saved).toBe(2)
    expect(await readFile(path.join(wikiBaseDir, 'comparison/framework-comparison.md'), 'utf8')).toContain('category: comparison')
    expect(await readFile(path.join(wikiBaseDir, 'misc/uncategorized-note.md'), 'utf8')).toContain('category: misc')

    const index = await readFile(path.join(wikiBaseDir, 'index.md'), 'utf8')
    expect(index).toContain('## comparison')
    expect(index).toContain('## misc')
  })

  it('executes invalidate from the shared action schema', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })

    await execute(tool, {
      actions: [{
        action: 'create',
        category: 'domain',
        name: 'Legacy concept',
        description: 'A concept that will be superseded',
        content: 'This concept is current.',
      }],
    })
    const result = await execute(tool, {
      actions: [{
        action: 'invalidate',
        category: 'domain',
        name: 'Legacy concept',
        description: 'Superseded concept',
        content: 'Replaced by the current architecture.',
      }],
    })

    expect(result.saved).toBe(1)
    expect(await readFile(path.join(wikiBaseDir, 'domain/legacy-concept.md'), 'utf8')).toContain('[已过期] Replaced by the current architecture.')
  })

  it('persists optional sources and origin in frontmatter and merges sources on update', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })

    await execute(tool, {
      actions: [{
        action: 'create',
        category: 'domain',
        name: 'Synthesized analysis',
        description: 'Analysis from multiple sources',
        content: 'The system uses a layered architecture.',
        origin: 'ingest',
        sources: [
          { type: 'url', value: 'https://example.com/article', title: 'Article' },
        ],
      }],
    })

    const raw = await readFile(path.join(wikiBaseDir, 'domain/synthesized-analysis.md'), 'utf8')
    expect(raw).toContain('origin: ingest')
    expect(raw).toContain('https://example.com/article')

    await execute(tool, {
      actions: [{
        action: 'update',
        category: 'domain',
        name: 'Synthesized analysis',
        target: 'synthesized-analysis.md',
        description: 'Updated with additional source',
        content: 'The system uses a layered architecture with clear boundaries.',
        origin: 'query',
        sources: [
          { type: 'git', value: 'owner/repo', revision: 'abc123' },
        ],
      }],
    })

    const updated = await readFile(path.join(wikiBaseDir, 'domain/synthesized-analysis.md'), 'utf8')
    expect(updated).toContain('origin: query')
    expect(updated).toContain('https://example.com/article')
    expect(updated).toContain('owner/repo')
    expect(updated).toContain('abc123')
  })

  it('resolves page names and non-canonical targets to one file', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })

    await execute(tool, { actions: [{
      action: 'create', category: 'domain', name: 'Wiki 维护核心操作', description: 'Canonical target', content: 'Create',
    }] })
    await execute(tool, { actions: [{
      action: 'update', category: 'domain', name: 'Wiki 维护核心操作', target: 'Wiki 维护核心操作.md', description: 'Canonical target', content: 'Update',
    }] })
    await execute(tool, { actions: [{
      action: 'replace', category: 'domain', name: 'Wiki 维护核心操作', target: 'wiki-维护核心操作', description: 'Canonical target', content: 'Replace',
    }] })

    expect(await readdir(wikiBaseDir)).not.toContain('Wiki 维护核心操作.md')

    const duplicate = await execute(tool, { actions: [{
      action: 'create', category: 'domain', name: 'wiki-维护核心操作', description: 'Duplicate', content: 'Duplicate',
    }] })
    expect(duplicate.failed).toBe(1)
    expect(duplicate.results[0].error).toContain('already exists')
  })

  it('does not warn on cross references to pages created in the same batch', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })
    await execute(tool, { actions: [{
      action: 'create', category: 'domain', name: 'Existing Page', description: 'Existing', content: 'Existing',
    }] })

    const result = await execute(tool, {
      actions: [
        {
          action: 'create',
          category: 'domain',
          name: 'New Architecture',
          description: 'New page referenced by a later action',
          content: 'Architecture overview.',
        },
        {
          action: 'update',
          category: 'domain',
          name: 'Existing Page',
          target: 'existing-page.md',
          description: 'References the page created in this batch',
          content: 'See [[New Architecture]] and the missing [[Nonexistent Page]].',
        },
      ],
    })

    expect(result.saved).toBe(2)
    const updateWarnings = result.results[1].warnings ?? []
    expect(updateWarnings.join('\n')).not.toContain('New Architecture')
    expect(updateWarnings.join('\n')).toContain('Nonexistent Page')
  })

  it('removes merge source pages after merging into target', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })
    await execute(tool, { actions: [
      { action: 'create', category: 'domain', name: 'Merge Target', description: 'Target', content: 'Target content' },
      { action: 'create', category: 'domain', name: 'Merge Source', description: 'Source', content: 'Source content' },
    ] })

    const result = await execute(tool, { actions: [{
      action: 'merge',
      category: 'domain',
      name: 'Merge Target',
      target: 'merge-target.md',
      mergeTargets: ['merge-source.md'],
      description: 'Merge pages',
      content: '',
    }] })

    expect(result.saved).toBe(1)
    await expect(readFile(path.join(wikiBaseDir, 'domain/merge-source.md'), 'utf8')).rejects.toThrow()
  })

  it('serializes concurrent saves for the same Wiki directory', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })
    await Promise.all(['One', 'Two', 'Three'].map(name => execute(tool, { actions: [{
      action: 'create', category: 'domain', name: `Concurrent ${name}`, description: name, content: name,
    }] })))

    const index = await readFile(path.join(wikiBaseDir, 'index.md'), 'utf8')
    expect(index).toContain('Concurrent One')
    expect(index).toContain('Concurrent Two')
    expect(index).toContain('Concurrent Three')
  })

  it('writes query origin to log when all actions use query origin', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })

    await execute(tool, {
      actions: [{
        action: 'create',
        category: 'domain',
        name: 'Query result',
        description: 'A comparison discovered during query',
        content: 'Option A is faster than Option B for this use case.',
        origin: 'query',
      }],
    })

    const log = await readFile(path.join(wikiBaseDir, 'log.md'), 'utf8')
    expect(log).toContain('query')
  })
})
