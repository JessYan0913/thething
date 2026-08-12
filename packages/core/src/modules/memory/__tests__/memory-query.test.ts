import { describe, expect, it } from 'vitest'
import type { MemoryEntry } from '../memory-io'
import { rankMemories, relevanceScore, importanceScore, getImportance } from '../memory-query'

function entry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  return {
    content: '内容',
    type: 'preference',
    pinned: false,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('getImportance', () => {
  it('uses explicit importance when provided', () => {
    const e = entry({ id: 'a', importance: 9 })
    expect(getImportance(e)).toBe(9)
  })

  it('derives default importance from type', () => {
    expect(getImportance(entry({ id: 'a', type: 'correction' }))).toBe(8)
    expect(getImportance(entry({ id: 'b', type: 'explicit' }))).toBe(7)
    expect(getImportance(entry({ id: 'c', type: 'identity' }))).toBe(6)
    expect(getImportance(entry({ id: 'd', type: 'preference' }))).toBe(5)
  })

  it('normalizes importance to [0,1]', () => {
    expect(importanceScore(entry({ id: 'a', type: 'correction' }))).toBeCloseTo((8 - 1) / 9)
  })
})

describe('relevanceScore', () => {
  it('scores keyword overlap between query and content', () => {
    const score = relevanceScore('回复用文字', '不喜欢看表格，回复用文字')
    expect(score).toBeGreaterThan(0)
  })

  it('returns 0 when query is empty', () => {
    expect(relevanceScore(undefined, 'anything')).toBe(0)
    expect(relevanceScore('', 'anything')).toBe(0)
  })

  it('returns 0 when no overlap', () => {
    expect(relevanceScore('量子计算', '喜欢日料')).toBe(0)
  })
})

describe('rankMemories', () => {
  const now = Date.now()
  const recent = new Date(now - 1_000).toISOString() // 刚刚
  const old = new Date(now - 40 * 86400_000).toISOString() // 40 天前

  it('sorts pinned memories first', () => {
    const a = entry({ id: 'a', pinned: false, updated: recent })
    const b = entry({ id: 'b', pinned: true, updated: recent })
    const ranked = rankMemories([a, b])
    expect(ranked[0].id).toBe('b')
  })

  it('prefers newer memories when other factors are equal', () => {
    const a = entry({ id: 'a', updated: recent, type: 'preference' })
    const b = entry({ id: 'b', updated: old, type: 'preference' })
    const ranked = rankMemories([b, a])
    expect(ranked[0].id).toBe('a')
  })

  it('ranks relevant memories higher when query is provided', () => {
    const relevant = entry({ id: 'a', updated: old, content: '喜欢看日环比趋势', type: 'preference' })
    const irrelevant = entry({ id: 'b', updated: recent, content: '喜欢日料', type: 'preference' })
    const ranked = rankMemories([irrelevant, relevant], { query: '日环比趋势怎么算' })
    expect(ranked[0].id).toBe('a')
  })

  it('applies top-k truncation', () => {
    const items = [1, 2, 3, 4, 5].map(n => entry({ id: `m${n}`, updated: recent }))
    const ranked = rankMemories(items, { topK: 2 })
    expect(ranked).toHaveLength(2)
  })

  it('returns all when topK omitted', () => {
    const items = [1, 2, 3].map(n => entry({ id: `m${n}`, updated: recent }))
    expect(rankMemories(items)).toHaveLength(3)
  })
})
