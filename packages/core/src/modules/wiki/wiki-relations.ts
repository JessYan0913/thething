import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from './wiki-config'
import { readAllPages, type WikiSourceData } from './wiki-io'
import { createWikiSourceId } from './wiki-sources'

export interface WikiSourcePageRelation {
  filename: string
  name: string
  lastLinkedAt: string
}

export interface WikiSourcePageIndex {
  version: 1
  updatedAt: string
  sources: Record<string, {
    sourceId: string
    pages: WikiSourcePageRelation[]
  }>
}

function sourcePageIndexPath(wikiDir: string): string {
  return path.join(wikiDir, 'system', 'source-pages.json')
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp-${crypto.randomBytes(6).toString('hex')}`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, filePath)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}

export async function rebuildSourcePageIndex(
  wikiDir: string,
  config: WikiConfig = DEFAULT_WIKI_CONFIG,
): Promise<WikiSourcePageIndex> {
  const pages = await readAllPages(wikiDir, config)
  const sources: WikiSourcePageIndex['sources'] = {}

  for (const page of pages) {
    for (const source of page.data.sources ?? []) {
      const sourceId = createWikiSourceId(source)
      const entry = sources[sourceId] ?? { sourceId, pages: [] }
      if (!entry.pages.some(relation => relation.filename === page.filename)) {
        entry.pages.push({
          filename: page.filename,
          name: page.data.name,
          lastLinkedAt: page.data.updated,
        })
      }
      sources[sourceId] = entry
    }
  }

  for (const entry of Object.values(sources)) {
    entry.pages.sort((a, b) => a.filename.localeCompare(b.filename))
  }

  const index: WikiSourcePageIndex = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sources,
  }
  await atomicWriteJson(sourcePageIndexPath(wikiDir), index)
  return index
}

export async function readSourcePageIndex(wikiDir: string): Promise<WikiSourcePageIndex> {
  try {
    const parsed = JSON.parse(await fs.readFile(sourcePageIndexPath(wikiDir), 'utf8')) as WikiSourcePageIndex
    if (parsed.version !== 1 || !parsed.sources) throw new Error('Unsupported Wiki source-page index')
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return rebuildSourcePageIndex(wikiDir)
    }
    throw error
  }
}

export async function listPagesForSource(
  wikiDir: string,
  source: WikiSourceData | string,
): Promise<WikiSourcePageRelation[]> {
  const sourceId = typeof source === 'string' ? source : createWikiSourceId(source)
  if (!/^[a-f0-9]{20}$/.test(sourceId)) throw new Error(`Invalid Wiki source ID: ${sourceId}`)
  const index = await readSourcePageIndex(wikiDir)
  return index.sources[sourceId]?.pages ?? []
}
