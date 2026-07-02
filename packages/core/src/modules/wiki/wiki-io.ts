// ============================================================
// Wiki IO - 文件读写 + 索引 + 日志
// ============================================================
// 所有文件 IO 操作集中在此。代码只做 IO，不做语义判断。

import fs from 'fs/promises'
import path from 'path'
import { ensureWikiDirExists, pageNameToFilename, directoryExists } from './wiki-paths'
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from './wiki-config'
import { logger } from '../../primitives/logger'

// ============================================================
// 类型定义
// ============================================================

export interface WikiPageData {
  name: string
  description: string
  category: string
  created: string
  updated: string
}

export interface WikiPage {
  data: WikiPageData
  content: string
  filename: string
}

export interface IndexEntry {
  name: string
  description: string
  category: string
  filename: string
}

export interface LogEntry {
  timestamp: string
  operation: string
  description: string
  details: string[]
}

// ============================================================
// Frontmatter 序列化 / 解析
// ============================================================

/**
 * 将 WikiPageData 序列化为 YAML frontmatter
 */
export function formatFrontmatter(data: WikiPageData): string {
  const lines = [
    '---',
    `name: ${data.name}`,
    `description: ${data.description}`,
    `category: ${data.category}`,
    `created: ${data.created}`,
    `updated: ${data.updated}`,
    '---',
  ]
  return lines.join('\n')
}

/**
 * 从 .md 文件内容中解析 frontmatter + body
 */
export function parsePage(raw: string, filename: string): WikiPage | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null

  const fm = match[1]
  const content = match[2].trim()

  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  const category = fm.match(/^category:\s*(.+)$/m)?.[1]?.trim()
  const created = fm.match(/^created:\s*(.+)$/m)?.[1]?.trim()
  const updated = fm.match(/^updated:\s*(.+)$/m)?.[1]?.trim()

  if (!name || !description || !category || !created || !updated) return null

  return {
    data: {
      name,
      description,
      category,
      created,
      updated,
    },
    content,
    filename,
  }
}

// ============================================================
// 页面读写
// ============================================================

/**
 * 读取单个 wiki 页面
 */
export async function readPage(
  wikiDir: string,
  filename: string,
): Promise<WikiPage | null> {
  try {
    const filePath = path.join(wikiDir, filename)
    const raw = await fs.readFile(filePath, 'utf-8')
    return parsePage(raw, filename)
  } catch {
    return null
  }
}

/**
 * 读取页面内容（原始 markdown，含 frontmatter）
 */
export async function readPageRaw(
  wikiDir: string,
  filename: string,
): Promise<string | null> {
  try {
    return await fs.readFile(path.join(wikiDir, filename), 'utf-8')
  } catch {
    return null
  }
}

/**
 * 写入新 wiki 页面
 */
export async function writePage(
  wikiDir: string,
  data: WikiPageData,
  content: string,
): Promise<string> {
  await ensureWikiDirExists(wikiDir)

  const filename = pageNameToFilename(data.name)
  const fileContent = formatFrontmatter(data) + '\n\n' + content
  await fs.writeFile(path.join(wikiDir, filename), fileContent, 'utf-8')

  return filename
}

/**
 * 更新已有页面
 * 如果新内容与旧内容主题相同但信息不同（如"改用Go"），替换旧内容
 * 如果新内容是旧内容的补充（如追加新偏好），追加到旧内容
 *
 * 默认行为：替换（新内容包含旧内容的核心信息时）
 */
/**
 * 规范化文件名：确保以 .md 结尾
 */
function normalizeFilename(filename: string): string {
  return filename.endsWith('.md') ? filename : filename + '.md'
}

export async function updatePage(
  wikiDir: string,
  filename: string,
  newContent: string,
  mode: 'replace' | 'append' = 'replace',
): Promise<void> {
  const normalizedFilename = normalizeFilename(filename)
  const page = await readPage(wikiDir, normalizedFilename)
  if (!page) {
    logger.warn('WikiIO', `Page not found for update: ${normalizedFilename}`)
    return
  }

  const mergedContent = mode === 'append'
    ? page.content + '\n\n' + newContent
    : newContent

  const now = new Date().toISOString()
  const updatedData: WikiPageData = {
    ...page.data,
    updated: now,
  }

  const fileContent = formatFrontmatter(updatedData) + '\n\n' + mergedContent
  await fs.writeFile(path.join(wikiDir, normalizedFilename), fileContent, 'utf-8')
}

/**
 * 合并多个页面为一个
 */
export async function mergePages(
  wikiDir: string,
  targetFilename: string,
  sourceFilenames: string[],
): Promise<string | null> {
  const pages: WikiPage[] = []

  for (const fn of [targetFilename, ...sourceFilenames]) {
    const page = await readPage(wikiDir, normalizeFilename(fn))
    if (page) pages.push(page)
  }

  if (pages.length === 0) return null

  // 合并所有 content
  const mergedContent = pages.map(p => p.content).join('\n\n')
  const now = new Date().toISOString()

  // 使用第一个页面的 data 作为基础
  const mergedData: WikiPageData = {
    ...pages[0].data,
    updated: now,
  }

  // 写入合并后的页面
  const newFilename = await writePage(wikiDir, mergedData, mergedContent)

  // 删除旧页面
  const allFilenames = [targetFilename, ...sourceFilenames]
  for (const fn of allFilenames) {
    const normalizedFn = normalizeFilename(fn)
    if (normalizedFn !== newFilename) {
      await fs.unlink(path.join(wikiDir, normalizedFn)).catch(() => {})
    }
  }

  return newFilename
}

/**
 * 替换页面内容（完全覆盖）
 */
export async function replacePage(
  wikiDir: string,
  filename: string,
  data: WikiPageData,
  content: string,
): Promise<void> {
  const normalizedFilename = normalizeFilename(filename)
  const now = new Date().toISOString()
  const updatedData: WikiPageData = { ...data, updated: now }
  const fileContent = formatFrontmatter(updatedData) + '\n\n' + content
  await fs.writeFile(path.join(wikiDir, normalizedFilename), fileContent, 'utf-8')
}

/**
 * 标记页面为已过期
 */
export async function invalidatePage(
  wikiDir: string,
  filename: string,
  reason: string,
): Promise<void> {
  const normalizedFilename = normalizeFilename(filename)
  const page = await readPage(wikiDir, normalizedFilename)
  if (!page) return

  const now = new Date().toISOString()
  const updatedData: WikiPageData = { ...page.data, updated: now }
  const invalidatedContent = page.content + `\n\n> [已过期] ${reason}`
  const fileContent = formatFrontmatter(updatedData) + '\n\n' + invalidatedContent
  await fs.writeFile(path.join(wikiDir, normalizedFilename), fileContent, 'utf-8')
}

/**
 * 删除页面
 */
export async function deletePage(
  wikiDir: string,
  filename: string,
): Promise<void> {
  const normalizedFilename = normalizeFilename(filename)
  await fs.unlink(path.join(wikiDir, normalizedFilename)).catch(() => {})
}

// ============================================================
// 索引管理（index.md）
// ============================================================

/**
 * 重建 index.md
 */
export async function rebuildIndex(
  wikiDir: string,
  config: WikiConfig = DEFAULT_WIKI_CONFIG,
): Promise<void> {
  const entries: IndexEntry[] = []

  // 扫描所有 .md 文件（排除 index.md 和 log.md）
  try {
    const files = await fs.readdir(wikiDir)
    const mdFiles = files.filter(f =>
      f.endsWith('.md') && f !== config.indexFile && f !== config.logFile
    )

    for (const filename of mdFiles) {
      const page = await readPage(wikiDir, filename)
      if (page) {
        entries.push({
          name: page.data.name,
          description: page.data.description,
          category: page.data.category,
          filename,
        })
      }
    }
  } catch {
    // 目录可能不存在
  }

  // 按 category 分组
  const grouped: Record<string, IndexEntry[]> = {}
  for (const entry of entries) {
    if (!grouped[entry.category]) grouped[entry.category] = []
    grouped[entry.category].push(entry)
  }

  const lines: string[] = [
    '# index.md',
    '',
    '> 此文件是知识库的入口。查询时先读此文件，再读相关页面。',
    '',
  ]

  for (const category of config.categories) {
    const catEntries = grouped[category]
    if (!catEntries || catEntries.length === 0) continue

    lines.push(`## ${category}`)
    lines.push('')

    for (const entry of catEntries) {
      const link = `[[${entry.name}]]`
      lines.push(`- ${link} — ${entry.description}`)
    }

    lines.push('')
  }

  const indexContent = lines.join('\n')
  await fs.writeFile(path.join(wikiDir, config.indexFile), indexContent, 'utf-8')
}

/**
 * 读取 index.md 并解析为条目列表
 */
export async function readIndex(
  wikiDir: string,
  config: WikiConfig = DEFAULT_WIKI_CONFIG,
): Promise<IndexEntry[]> {
  try {
    const content = await fs.readFile(path.join(wikiDir, config.indexFile), 'utf-8')
    return parseIndex(content)
  } catch {
    return []
  }
}

/**
 * 解析 index.md 内容为条目列表
 */
export function parseIndex(content: string): IndexEntry[] {
  const entries: IndexEntry[] = []
  const lines = content.split('\n')
  let currentCategory = ''

  for (const line of lines) {
    // 匹配 category header: ## identity
    const categoryMatch = line.match(/^## (\w+)/)
    if (categoryMatch) {
      currentCategory = categoryMatch[1]
      continue
    }

    // 匹配条目: - [[name]] — description
    const entryMatch = line.match(/^- \[\[(.+?)\]\]\s*—\s*(.+)$/)
    if (entryMatch && currentCategory) {
      entries.push({
        name: entryMatch[1],
        description: entryMatch[2],
        category: currentCategory,
        filename: pageNameToFilename(entryMatch[1]),
      })
    }
  }

  return entries
}

/**
 * addCrossReferences 已移除 — 交叉引用由 LLM 在 ingest 时通过工具调用完成
 * LLM 读取 index 后，使用 read_wiki_page 工具获取相关页面内容，
 * 然后在生成的 content 中主动添加 [[wiki-link]]
 */

// ============================================================
// 日志管理（log.md）
// ============================================================

/**
 * 追加日志条目
 */
export async function appendLog(
  wikiDir: string,
  entry: LogEntry,
  config: WikiConfig = DEFAULT_WIKI_CONFIG,
): Promise<void> {
  const lines: string[] = [
    `## [${entry.timestamp}] ${entry.operation} | ${entry.description}`,
  ]

  for (const detail of entry.details) {
    lines.push(`- ${detail}`)
  }

  lines.push('')

  const logLine = lines.join('\n')

  try {
    // 追加到现有日志
    const existing = await fs.readFile(path.join(wikiDir, config.logFile), 'utf-8')
    await fs.writeFile(
      path.join(wikiDir, config.logFile),
      existing + logLine,
      'utf-8',
    )
  } catch {
    // 文件不存在，创建新日志
    const header = '# log.md\n\n'
    await fs.writeFile(
      path.join(wikiDir, config.logFile),
      header + logLine,
      'utf-8',
    )
  }
}

// ============================================================
// 批量读取
// ============================================================

/**
 * 读取 wiki 目录中所有页面
 */
export async function readAllPages(
  wikiDir: string,
  config: WikiConfig = DEFAULT_WIKI_CONFIG,
): Promise<WikiPage[]> {
  const pages: WikiPage[] = []

  try {
    const files = await fs.readdir(wikiDir)
    const mdFiles = files.filter(f =>
      f.endsWith('.md') && f !== config.indexFile && f !== config.logFile
    )

    for (const filename of mdFiles) {
      const page = await readPage(wikiDir, filename)
      if (page) pages.push(page)
    }
  } catch {
    // 目录可能不存在
  }

  return pages
}
