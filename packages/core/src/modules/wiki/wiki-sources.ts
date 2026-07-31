import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { WikiSourceData } from './wiki-io'

export interface WikiSourceRecord extends WikiSourceData {
  id: string
  registeredAt: string
  snapshot?: string
  contentHash?: string
}

export interface RegisterWikiSourceInput extends WikiSourceData {
  content?: string
}

export interface RegisterWikiSourceResult {
  record: WikiSourceRecord
  created: boolean
  snapshotCreated: boolean
}

function sourceKey(source: WikiSourceData): string {
  return JSON.stringify({
    type: source.type,
    value: source.value,
    revision: source.revision ?? '',
  })
}

export function createWikiSourceId(source: WikiSourceData): string {
  return crypto.createHash('sha256').update(sourceKey(source)).digest('hex').slice(0, 20)
}

function getRawSourcesDir(wikiDir: string): string {
  return path.join(wikiDir, 'raw')
}

function getSourceRegistryPath(wikiDir: string): string {
  return path.join(getRawSourcesDir(wikiDir), 'sources.jsonl')
}

async function readSourceRecords(wikiDir: string): Promise<WikiSourceRecord[]> {
  try {
    const raw = await fs.readFile(getSourceRegistryPath(wikiDir), 'utf8')
    return raw
      .split('\n')
      .filter(Boolean)
      .flatMap(line => {
        try {
          return [JSON.parse(line) as WikiSourceRecord]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

export async function registerWikiSource(
  wikiDir: string,
  input: RegisterWikiSourceInput,
): Promise<RegisterWikiSourceResult> {
  const rawDir = getRawSourcesDir(wikiDir)
  const snapshotsDir = path.join(rawDir, 'snapshots')
  await fs.mkdir(snapshotsDir, { recursive: true })

  const id = createWikiSourceId(input)
  const existing = (await readSourceRecords(wikiDir)).find(record => record.id === id)
  if (existing) {
    return { record: existing, created: false, snapshotCreated: false }
  }

  let snapshot: string | undefined
  let contentHash: string | undefined
  let snapshotCreated = false
  if (input.content !== undefined) {
    contentHash = crypto.createHash('sha256').update(input.content).digest('hex')
    snapshot = path.posix.join('raw', 'snapshots', `${id}.md`)
    const snapshotPath = path.join(wikiDir, snapshot)
    try {
      await fs.writeFile(snapshotPath, input.content, { encoding: 'utf8', flag: 'wx' })
      snapshotCreated = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  const { content: _content, ...source } = input
  const record: WikiSourceRecord = {
    ...source,
    id,
    registeredAt: new Date().toISOString(),
    snapshot,
    contentHash,
  }

  await fs.appendFile(getSourceRegistryPath(wikiDir), `${JSON.stringify(record)}\n`, 'utf8')
  return { record, created: true, snapshotCreated }
}

export async function listWikiSources(wikiDir: string): Promise<WikiSourceRecord[]> {
  return readSourceRecords(wikiDir)
}
