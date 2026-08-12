import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSaveMemoryTool } from '../save-memory'

async function execute(tool: any, input: unknown): Promise<any> {
  return tool.execute(input, { toolCallId: 'test', messages: [] })
}

describe('save_memory tool', () => {
  it('guides the model not to write sensitive information', () => {
    const memoryBaseDir = path.join(os.tmpdir(), 'thething-memory-prompt-check')
    const tool = createSaveMemoryTool({ memoryBaseDir })
    const description = String((tool as any).description ?? '')

    expect(description).toContain('敏感信息不写入')
    expect(description).toContain('密码')
    expect(description).toContain('API key')
  })

  it('saves a normal memory and returns its id', async () => {
    const memoryBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-memory-'))
    const tool = createSaveMemoryTool({ memoryBaseDir })
    const result = await execute(tool, {
      content: '不喜欢看表格，回复用文字',
      type: 'preference',
      dimension: 'display-format',
      source: '用户原话',
    })

    expect(result.saved).toBe(true)
    expect(result.id).toBeTruthy()
    expect(result.conflicts).toBeUndefined()
  })

  it('reports same-dimension conflicts without deleting old memories', async () => {
    const memoryBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-memory-'))
    const tool = createSaveMemoryTool({ memoryBaseDir })

    const first = await execute(tool, {
      content: '喜欢日环比',
      type: 'preference',
      dimension: 'display-format',
    })
    expect(first.saved).toBe(true)

    const second = await execute(tool, {
      content: '改看月同比',
      type: 'preference',
      dimension: 'display-format',
    })

    expect(second.saved).toBe(true)
    expect(second.conflicts).toBeDefined()
    expect(second.conflicts).toHaveLength(1)
    expect(second.conflicts[0].content).toBe('喜欢日环比')
    expect(second.conflicts[0].id).toBe(first.id)
  })

  it('does not report conflicts when no dimension is provided', async () => {
    const memoryBaseDir = await mkdtemp(path.join(os.tmpdir(), 'thething-memory-'))
    const tool = createSaveMemoryTool({ memoryBaseDir })

    await execute(tool, { content: '喜欢火锅', type: 'preference' })
    const second = await execute(tool, { content: '喜欢日料', type: 'preference' })

    expect(second.saved).toBe(true)
    expect(second.conflicts).toBeUndefined()
  })
})
