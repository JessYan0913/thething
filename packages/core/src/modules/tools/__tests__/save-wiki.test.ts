import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSaveWikiTool, detectProceduralWikiContent, validateWikiActionBoundary } from '../save-wiki'

async function execute(tool: any, input: unknown): Promise<any> {
  return tool.execute(input, { toolCallId: 'test', messages: [] })
}

describe('save_wiki knowledge boundaries', () => {
  it('warns when content is dominated by installation steps', () => {
    const warnings = detectProceduralWikiContent(`
## 安装步骤
1. 安装依赖：pnpm install
2. 配置服务并运行命令
`)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('操作手册')
  })

  it('does not warn for conceptual architecture with an isolated code term', () => {
    const warnings = detectProceduralWikiContent(`
## Adapter architecture
The adapter separates timeline semantics from rendering backends.
A project may use pnpm install during development, but installation is not the subject.
`)

    expect(warnings).toEqual([])
  })

  it('rejects direct operations on internally maintained pages', () => {
    expect(validateWikiActionBoundary({
      action: 'update',
      category: 'domain',
      knowledgeType: 'concept',
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
      knowledgeType: 'architecture',
      name: 'HyperFrames overview',
      target: 'hyperframes-overview.md',
      mergeTargets: ['hyperframes-overview'],
      description: 'Invalid self merge',
      content: '',
    })).toContain('cannot also appear')

    expect(validateWikiActionBoundary({
      action: 'merge',
      category: 'domain',
      knowledgeType: 'architecture',
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
        knowledgeType: 'concept',
        name: 'index',
        description: 'Attempted replacement',
        content: 'malicious index content',
      }],
    })

    expect(result.failed).toBe(1)
    expect(result.results[0].error).toContain('maintained internally')
    expect(await readFile(path.join(wikiBaseDir, 'index.md'), 'utf8')).not.toContain('malicious index content')
  })

  it('saves conceptual knowledge and returns procedural warnings', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })

    const result = await execute(tool, {
      actions: [{
        action: 'create',
        category: 'domain',
        knowledgeType: 'concept',
        name: 'Package installation concept',
        description: 'How package installation resolves dependencies',
        content: '## 安装步骤\n1. 安装依赖：pnpm install\n2. 配置服务并运行命令',
      }],
    })

    expect(result.saved).toBe(1)
    expect(result.results[0].warnings[0]).toContain('操作手册')
    expect(await readFile(path.join(wikiBaseDir, 'package-installation-concept.md'), 'utf8')).toContain('Package installation concept')
  })

  it('executes invalidate from the shared action schema', async () => {
    const wikiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-'))
    const tool = createSaveWikiTool({ wikiBaseDir })

    await execute(tool, {
      actions: [{
        action: 'create',
        category: 'domain',
        knowledgeType: 'concept',
        name: 'Legacy concept',
        description: 'A concept that will be superseded',
        content: 'This concept is current.',
      }],
    })
    const result = await execute(tool, {
      actions: [{
        action: 'invalidate',
        category: 'domain',
        knowledgeType: 'concept',
        name: 'Legacy concept',
        description: 'Superseded concept',
        content: 'Replaced by the current architecture.',
      }],
    })

    expect(result.saved).toBe(1)
    expect(await readFile(path.join(wikiBaseDir, 'legacy-concept.md'), 'utf8')).toContain('[已过期] Replaced by the current architecture.')
  })
})
