import { describe, expect, it } from 'vitest'
import { WIKI_GUIDELINES_PROMPT, wikiActionSchema } from '../wiki-prompt'

describe('wiki knowledge boundaries', () => {
  it('keeps the current task primary and reflects after completion', () => {
    expect(WIKI_GUIDELINES_PROMPT).toContain('当前任务优先')
    expect(WIKI_GUIDELINES_PROMPT).toContain('完成任务后')
    expect(WIKI_GUIDELINES_PROMPT).toContain('受控反思')
  })

  it('does not save merely because external sources were searched', () => {
    expect(WIKI_GUIDELINES_PROMPT).not.toContain('搜索外部来源后，将整理的知识保存到 Wiki')
    expect(WIKI_GUIDELINES_PROMPT).toContain('不要仅因为进行了搜索')
  })

  it('separates conceptual knowledge from executable skills', () => {
    expect(WIKI_GUIDELINES_PROMPT).toContain('Wiki 回答“是什么、为什么、如何关联”')
    expect(WIKI_GUIDELINES_PROMPT).toContain('必须产出可被加载器识别的 SKILL.md')
  })

  it('requires an explicit conceptual knowledge type', () => {
    const valid = wikiActionSchema.safeParse({
      action: 'create',
      category: 'domain',
      knowledgeType: 'architecture',
      name: 'Adapter architecture',
      description: 'How adapters isolate rendering backends',
      content: 'Adapters separate the timeline model from renderer implementations.',
    })
    const missingType = wikiActionSchema.safeParse({
      action: 'create',
      category: 'domain',
      name: 'Adapter architecture',
      description: 'How adapters isolate rendering backends',
      content: 'Adapters separate the timeline model from renderer implementations.',
    })

    expect(valid.success).toBe(true)
    expect(missingType.success).toBe(false)
  })

  it('keeps invalidate available in the shared action schema', () => {
    expect(wikiActionSchema.safeParse({
      action: 'invalidate',
      category: 'domain',
      knowledgeType: 'concept',
      name: 'Old concept',
      description: 'Outdated concept',
      content: 'Superseded by the current architecture.',
      target: 'old-concept.md',
    }).success).toBe(true)
  })
})
