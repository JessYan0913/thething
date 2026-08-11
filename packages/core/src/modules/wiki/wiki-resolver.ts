import fs from 'fs/promises'
import path from 'path'
import { pageNameToFilename } from './wiki-paths'

const INTERNAL_PAGE_FILENAMES = new Set(['index.md', 'log.md'])

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/i, '')
}

function assertSimplePageReference(reference: string): string {
  const trimmed = reference.trim()
  if (!trimmed) throw new Error(`Invalid Wiki page reference: ${reference}`)
  // 允许多层路径（如 domain/finance/xxx），但拒绝空段
  if (trimmed.split('/').some(p => !p)) throw new Error(`Invalid Wiki page reference: ${reference}`)
  return trimmed
}

export function canonicalWikiPageFilename(reference: string): string {
  const simpleReference = assertSimplePageReference(reference)
  const parts = simpleReference.split('/')
  if (parts.length > 1) {
    // 最后一段是文件名，其余是目录段，各自规范化
    const dirs = parts.slice(0, -1).map(p => pageNameToFilename(p).replace('.md', ''))
    const file = pageNameToFilename(stripMarkdownExtension(parts[parts.length - 1]))
    return dirs.join('/') + '/' + file
  }
  return pageNameToFilename(stripMarkdownExtension(simpleReference))
}

function readFrontmatterName(raw: string): string | undefined {
  const match = raw.match(/^---\s*\n[\s\S]*?^name:\s*(.+?)\s*$[\s\S]*?^---\s*$/m)
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '')
}

/**
 * 递归收集 wikiDir 下所有 .md 页面文件（排除 index.md / log.md / system/）
 */
async function collectAllPageFiles(wikiDir: string): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string, prefix: string) {
    let entries: import('fs').Dirent[]
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name === 'system') continue
        await walk(path.join(dir, entry.name), rel)
      } else if (entry.isFile() && entry.name.endsWith('.md') && !INTERNAL_PAGE_FILENAMES.has(entry.name)) {
        results.push(rel)
      }
    }
  }
  await walk(wikiDir, '')
  return results
}

export async function resolveWikiPageFilename(
  wikiDir: string,
  reference: string,
): Promise<string | null> {
  const canonical = canonicalWikiPageFilename(reference)
  if (INTERNAL_PAGE_FILENAMES.has(canonical)) return canonical

  const filenames = await collectAllPageFiles(wikiDir)

  // 精确匹配
  if (filenames.includes(canonical)) return canonical

  // 规范化后模糊匹配（处理大小写/连字符差异）
  const referenceKey = canonical
  for (const filename of filenames) {
    if (canonicalWikiPageFilename(filename) === referenceKey) return filename

    // 只按 frontmatter name 匹配（避免读取所有文件，先对basename做粗筛）
    const basename = path.basename(filename, '.md')
    if (canonicalWikiPageFilename(basename) !== canonicalWikiPageFilename(path.basename(reference, '.md'))) continue

    try {
      const raw = await fs.readFile(path.join(wikiDir, filename), 'utf8')
      const pageName = readFrontmatterName(raw)
      if (pageName && canonicalWikiPageFilename(pageName) === referenceKey) return filename
    } catch {
      // ignore
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
