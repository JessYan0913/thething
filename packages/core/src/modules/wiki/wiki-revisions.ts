import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { WikiSourceData } from './wiki-io'
import { parsePage, readPageRaw } from './wiki-io'

export type WikiRevisionOperation =
  | 'create'
  | 'update'
  | 'replace'
  | 'merge'
  | 'invalidate'
  | 'restore'
  | 'delete'

export interface WikiRevisionRecord {
  id: string
  pageId: string
  filename: string
  pageName?: string
  createdAt: string
  operation: WikiRevisionOperation
  origin?: 'ingest' | 'query' | 'maintenance'
  contentHash: string
  parentRevisionId?: string
  restoredFromRevisionId?: string
  reason?: string
  sources?: WikiSourceData[]
  snapshot: string
}

export interface CapturePageRevisionInput {
  filename: string
  operation: WikiRevisionOperation
  raw?: string
  restoredFromRevisionId?: string
  reason?: string
}

export interface WikiRevisionSnapshot {
  record: WikiRevisionRecord
  raw: string
}

export interface WikiRevisionDiff {
  filename: string
  from: { revisionId?: string; contentHash: string }
  to: { revisionId?: string; contentHash: string }
  changed: boolean
  unifiedDiff: string
}

function normalizePageFilename(filename: string): string {
  const basename = path.basename(filename)
  if (basename !== filename || !basename.endsWith('.md') || basename === 'index.md' || basename === 'log.md') {
    throw new Error(`Invalid Wiki page filename: ${filename}`)
  }
  return basename
}

function validateRevisionId(revisionId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(revisionId)) {
    throw new Error(`Invalid Wiki revision ID: ${revisionId}`)
  }
  return revisionId
}

function createPageId(filename: string): string {
  return crypto.createHash('sha256').update(filename).digest('hex').slice(0, 20)
}

function hashContent(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function revisionsDir(wikiDir: string, filename: string): string {
  return path.join(wikiDir, 'system', 'revisions', createPageId(filename))
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp-${crypto.randomBytes(6).toString('hex')}`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, filePath)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}

export async function listPageRevisions(
  wikiDir: string,
  filenameInput: string,
): Promise<WikiRevisionRecord[]> {
  const filename = normalizePageFilename(filenameInput)
  const dir = revisionsDir(wikiDir, filename)
  try {
    const files = (await fs.readdir(dir)).filter(file => file.endsWith('.json'))
    const records = await Promise.all(files.map(async file => {
      try {
        return JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) as WikiRevisionRecord
      } catch {
        return null
      }
    }))
    return records
      .filter((record): record is WikiRevisionRecord => record !== null && record.filename === filename)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  } catch {
    return []
  }
}

export async function initializeWikiRevisionBaselines(wikiDir: string): Promise<WikiRevisionRecord[]> {
  const created: WikiRevisionRecord[] = []
  let files: string[] = []
  try {
    files = (await fs.readdir(wikiDir)).filter(file => file.endsWith('.md') && file !== 'index.md' && file !== 'log.md')
  } catch {
    return created
  }
  for (const filename of files) {
    if ((await listPageRevisions(wikiDir, filename)).length > 0) continue
    const revision = await capturePageRevision(wikiDir, {
      filename,
      operation: 'create',
      reason: 'baseline',
    })
    if (revision) created.push(revision)
  }
  return created
}

export async function readPageRevision(
  wikiDir: string,
  filenameInput: string,
  revisionIdInput: string,
): Promise<WikiRevisionSnapshot | null> {
  const filename = normalizePageFilename(filenameInput)
  const revisionId = validateRevisionId(revisionIdInput)
  const dir = revisionsDir(wikiDir, filename)
  try {
    const record = JSON.parse(await fs.readFile(path.join(dir, `${revisionId}.json`), 'utf8')) as WikiRevisionRecord
    if (record.filename !== filename || record.id !== revisionId) return null
    const raw = await fs.readFile(path.join(wikiDir, record.snapshot), 'utf8')
    if (hashContent(raw) !== record.contentHash) throw new Error(`Wiki revision snapshot hash mismatch: ${revisionId}`)
    return { record, raw }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function capturePageRevision(
  wikiDir: string,
  input: CapturePageRevisionInput,
): Promise<WikiRevisionRecord | null> {
  const filename = normalizePageFilename(input.filename)
  const raw = input.raw ?? await readPageRaw(wikiDir, filename)
  if (raw === null) return null

  const contentHash = hashContent(raw)
  const existing = await listPageRevisions(wikiDir, filename)
  const latest = existing.at(-1)
  if (latest?.contentHash === contentHash && input.operation !== 'restore' && input.operation !== 'delete') return latest

  const createdAt = new Date().toISOString()
  const id = `${createdAt.replace(/[-:.TZ]/g, '').slice(0, 17)}-${contentHash.slice(0, 12)}-${crypto.randomBytes(3).toString('hex')}`
  const dir = revisionsDir(wikiDir, filename)
  const snapshotRelative = path.posix.join('system', 'revisions', createPageId(filename), `${id}.md`)
  const parsed = parsePage(raw, filename)
  const record: WikiRevisionRecord = {
    id,
    pageId: createPageId(filename),
    filename,
    pageName: parsed?.data.name,
    createdAt,
    operation: input.operation,
    origin: parsed?.data.origin,
    contentHash,
    parentRevisionId: latest?.id,
    restoredFromRevisionId: input.restoredFromRevisionId,
    reason: input.reason,
    sources: parsed?.data.sources,
    snapshot: snapshotRelative,
  }

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${id}.md`), raw, { encoding: 'utf8', flag: 'wx' })
  await fs.writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return record
}

function buildUnifiedDiff(fromRaw: string, toRaw: string, fromLabel: string, toLabel: string): string {
  if (fromRaw === toRaw) return ''
  const from = fromRaw.split('\n')
  const to = toRaw.split('\n')
  const lengths = Array.from({ length: from.length + 1 }, () => new Uint32Array(to.length + 1))
  for (let i = from.length - 1; i >= 0; i--) {
    for (let j = to.length - 1; j >= 0; j--) {
      lengths[i][j] = from[i] === to[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const lines = [`--- ${fromLabel}`, `+++ ${toLabel}`, `@@ -1,${from.length} +1,${to.length} @@`]
  let i = 0
  let j = 0
  while (i < from.length && j < to.length) {
    if (from[i] === to[j]) {
      lines.push(` ${from[i]}`)
      i++
      j++
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      lines.push(`-${from[i++]}`)
    } else {
      lines.push(`+${to[j++]}`)
    }
  }
  while (i < from.length) lines.push(`-${from[i++]}`)
  while (j < to.length) lines.push(`+${to[j++]}`)
  return lines.join('\n')
}

async function resolveRevisionOrCurrent(
  wikiDir: string,
  filename: string,
  revisionId?: string,
): Promise<{ revisionId?: string; raw: string; contentHash: string }> {
  if (revisionId) {
    const snapshot = await readPageRevision(wikiDir, filename, revisionId)
    if (!snapshot) throw new Error(`Wiki revision not found: ${revisionId}`)
    return { revisionId, raw: snapshot.raw, contentHash: snapshot.record.contentHash }
  }
  const raw = await readPageRaw(wikiDir, filename)
  if (raw === null) throw new Error(`Wiki page not found: ${filename}`)
  return { raw, contentHash: hashContent(raw) }
}

export async function diffPageRevisions(
  wikiDir: string,
  input: { filename: string; fromRevisionId?: string; toRevisionId?: string },
): Promise<WikiRevisionDiff> {
  const filename = normalizePageFilename(input.filename)
  if (!input.fromRevisionId && !input.toRevisionId) {
    throw new Error('At least one revision ID is required for a Wiki diff')
  }
  const from = await resolveRevisionOrCurrent(wikiDir, filename, input.fromRevisionId)
  const to = await resolveRevisionOrCurrent(wikiDir, filename, input.toRevisionId)
  return {
    filename,
    from: { revisionId: from.revisionId, contentHash: from.contentHash },
    to: { revisionId: to.revisionId, contentHash: to.contentHash },
    changed: from.contentHash !== to.contentHash,
    unifiedDiff: buildUnifiedDiff(from.raw, to.raw, from.revisionId ?? 'current', to.revisionId ?? 'current'),
  }
}

export async function restorePageRevision(
  wikiDir: string,
  input: { filename: string; revisionId: string; reason?: string },
): Promise<WikiRevisionRecord> {
  const filename = normalizePageFilename(input.filename)
  const snapshot = await readPageRevision(wikiDir, filename, input.revisionId)
  if (!snapshot) throw new Error(`Wiki revision not found: ${input.revisionId}`)
  await atomicWrite(path.join(wikiDir, filename), snapshot.raw)
  const revision = await capturePageRevision(wikiDir, {
    filename,
    operation: 'restore',
    raw: snapshot.raw,
    restoredFromRevisionId: snapshot.record.id,
    reason: input.reason,
  })
  if (!revision) throw new Error(`Failed to capture restored Wiki revision: ${filename}`)
  return revision
}
