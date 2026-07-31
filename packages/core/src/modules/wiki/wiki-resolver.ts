import fs from 'fs/promises'
import path from 'path'
import { pageNameToFilename } from './wiki-paths'

const INTERNAL_PAGE_FILENAMES = new Set(['index.md', 'log.md'])

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/i, '')
}

function assertSimplePageReference(reference: string): string {
  const trimmed = reference.trim()
  if (!trimmed || path.basename(trimmed) !== trimmed) {
    throw new Error(`Invalid Wiki page reference: ${reference}`)
  }
  return trimmed
}

export function canonicalWikiPageFilename(reference: string): string {
  const simpleReference = assertSimplePageReference(reference)
  return pageNameToFilename(stripMarkdownExtension(simpleReference))
}

function readFrontmatterName(raw: string): string | undefined {
  const match = raw.match(/^---\s*\n[\s\S]*?^name:\s*(.+?)\s*$[\s\S]*?^---\s*$/m)
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '')
}

export async function resolveWikiPageFilename(
  wikiDir: string,
  reference: string,
): Promise<string | null> {
  const canonical = canonicalWikiPageFilename(reference)
  if (INTERNAL_PAGE_FILENAMES.has(canonical)) return canonical

  let filenames: string[]
  try {
    filenames = (await fs.readdir(wikiDir)).filter(filename =>
      filename.endsWith('.md') && !INTERNAL_PAGE_FILENAMES.has(filename),
    )
  } catch {
    return null
  }

  if (filenames.includes(canonical)) return canonical

  const referenceKey = canonicalWikiPageFilename(reference)
  for (const filename of filenames) {
    if (canonicalWikiPageFilename(filename) === referenceKey) return filename

    try {
      const raw = await fs.readFile(path.join(wikiDir, filename), 'utf8')
      const pageName = readFrontmatterName(raw)
      if (pageName && canonicalWikiPageFilename(pageName) === referenceKey) return filename
    } catch {
      // Ignore unreadable or malformed pages and continue resolving other candidates.
    }
  }

  return null
}

export async function resolveWikiPageFilenameOrCanonical(
  wikiDir: string,
  reference: string,
): Promise<string> {
  return await resolveWikiPageFilename(wikiDir, reference)
    ?? canonicalWikiPageFilename(reference)
}
