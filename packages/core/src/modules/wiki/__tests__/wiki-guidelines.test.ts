import { describe, expect, it } from 'vitest'
import { WIKI_GUIDELINES_PROMPT, wikiActionSchema, wikiSourceSchema } from '../wiki-prompt'

describe('wiki maintenance guidelines', () => {
  it('describes the wiki as a persistent compounding artifact maintained by the agent', () => {
    expect(WIKI_GUIDELINES_PROMPT).toContain('持久化的知识库')
    expect(WIKI_GUIDELINES_PROMPT).toContain('复利')
    expect(WIKI_GUIDELINES_PROMPT).toContain('知识工件')
    expect(WIKI_GUIDELINES_PROMPT).toContain('Wiki 由你负责维护')
  })

  it('supports ingest, query feedback, and lint as continuing maintenance operations', () => {
    expect(WIKI_GUIDELINES_PROMPT).toContain('Ingest')
    expect(WIKI_GUIDELINES_PROMPT).toContain('查询中产生的有价值分析')
    expect(WIKI_GUIDELINES_PROMPT).toContain('Lint')
  })

  it('allows the schema and page forms to evolve without fixed knowledge types', () => {
    expect(WIKI_GUIDELINES_PROMPT).toContain('不是固定制度')
    expect(WIKI_GUIDELINES_PROMPT).toContain('不要求预先归入固定知识类型')

    expect(wikiActionSchema.safeParse({
      action: 'create',
      category: 'project',
      name: 'Development workflow',
      description: 'Evolving local development notes',
      content: 'Install, run, observe, and revise this page as the project evolves.',
    }).success).toBe(true)
  })

  it('keeps invalidate available in the shared action schema', () => {
    expect(wikiActionSchema.safeParse({
      action: 'invalidate',
      category: 'domain',
      name: 'Old concept',
      description: 'Outdated concept',
      content: 'Superseded by the current architecture.',
      target: 'old-concept.md',
    }).success).toBe(true)
  })

  it('accepts optional origin and sources without requiring them', () => {
    expect(wikiActionSchema.safeParse({
      action: 'create',
      category: 'domain',
      name: 'Test page',
      description: 'A page with provenance',
      content: 'Some synthesized knowledge.',
      origin: 'query',
      sources: [
        { type: 'url', value: 'https://example.com/article', title: 'Example' },
        { type: 'git', value: 'owner/repo', revision: 'abc123' },
      ],
    }).success).toBe(true)

    expect(wikiActionSchema.safeParse({
      action: 'create',
      category: 'domain',
      name: 'No provenance page',
      description: 'A page without sources',
      content: 'Knowledge without explicit provenance.',
    }).success).toBe(true)
  })

  it('requires explicit query provenance and preserves user-specified source semantics', () => {
    expect(WIKI_GUIDELINES_PROMPT).toContain('必须显式传 origin: query')
    expect(WIKI_GUIDELINES_PROMPT).toContain('不能仅因为信息出现在当前对话中就改成 conversation 来源')
    expect(WIKI_GUIDELINES_PROMPT).toContain('仓库与 commit 应登记为 git 来源')
    expect(WIKI_GUIDELINES_PROMPT).toContain('actions 传空数组')
  })

  it('validates source schema with required type and value', () => {
    expect(wikiSourceSchema.safeParse({
      type: 'file',
      value: '/path/to/file.ts',
    }).success).toBe(true)

    expect(wikiSourceSchema.safeParse({
      type: 'invalid',
      value: 'x',
    }).success).toBe(false)

    expect(wikiSourceSchema.safeParse({
      type: 'url',
    }).success).toBe(false)
  })
})
