import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeMemory, readAllMemories } from '../memory-io'

describe('memory io', () => {
  it('round-trips a memory with source and dimension', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'thething-memory-'))
    const id = await writeMemory(dir, {
      content: '不喜欢看表格，回复用文字',
      type: 'preference',
      dimension: 'display-format',
      source: '用户原话："我不喜欢看表格，回复用文字表述"',
    })

    const entries = await readAllMemories(dir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id,
      content: '不喜欢看表格，回复用文字',
      type: 'preference',
      dimension: 'display-format',
      source: '用户原话："我不喜欢看表格，回复用文字表述"',
    })
    expect(entries[0].pinned).toBe(false)
  })

  it('omits optional fields when not provided', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'thething-memory-'))
    const id = await writeMemory(dir, {
      content: '是公司 CFO',
      type: 'identity',
    })

    const entries = await readAllMemories(dir)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(id)
    expect(entries[0].dimension).toBeUndefined()
    expect(entries[0].source).toBeUndefined()
  })

  it('persists source in frontmatter for auditability', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'thething-memory-'))
    const id = await writeMemory(dir, {
      content: '禁止 mock 数据库',
      type: 'correction',
      source: '对话 3：用户纠正',
    })

    const raw = await readFile(path.join(dir, `${id}.md`), 'utf-8')
    expect(raw).toContain('source: 对话 3：用户纠正')
    expect(raw).toContain('type: correction')
  })

  it('sorts pinned memories first', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'thething-memory-'))
    await writeMemory(dir, { content: '普通条目', type: 'preference' })
    const pinnedId = await writeMemory(dir, { content: '置顶条目', type: 'identity', pinned: true })

    const entries = await readAllMemories(dir)
    expect(entries[0].id).toBe(pinnedId)
  })
})
