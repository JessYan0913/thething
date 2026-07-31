import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getWikiLintStatus } from '../wiki-maintenance'
import { createWikiGuidelinesSection } from '../../system-prompt/sections/wiki'

function logEntry(index: number, operation: string): string {
  return `## [2026-07-30T00:00:${String(index).padStart(2, '0')}.000Z] ${operation} | change ${index}\n`
}

describe('wiki lint maintenance reminder', () => {
  it('becomes due after lintInterval wiki changes since the last lint', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-maintenance-'))
    const log = [
      logEntry(0, 'lint'),
      ...Array.from({ length: 6 }, (_, index) => logEntry(index + 1, 'ingest')),
      ...Array.from({ length: 4 }, (_, index) => logEntry(index + 7, 'query')),
    ].join('')
    await writeFile(path.join(wikiDir, 'log.md'), log, 'utf8')

    const status = await getWikiLintStatus(wikiDir)
    expect(status).toEqual({ changesSinceLastLint: 10, due: true })

    const section = await createWikiGuidelinesSection(wikiDir)
    expect(section?.content).toContain('维护提醒')
    expect(section?.content).toContain('不要为了检查而打断当前任务')
  })

  it('resets the counter after a newer lint entry', async () => {
    const wikiDir = await mkdtemp(path.join(os.tmpdir(), 'thething-wiki-maintenance-'))
    const log = [
      ...Array.from({ length: 10 }, (_, index) => logEntry(index, 'ingest')),
      logEntry(10, 'lint'),
      logEntry(11, 'maintenance'),
    ].join('')
    await writeFile(path.join(wikiDir, 'log.md'), log, 'utf8')

    const status = await getWikiLintStatus(wikiDir)
    expect(status).toEqual({ changesSinceLastLint: 1, due: false })
  })
})
