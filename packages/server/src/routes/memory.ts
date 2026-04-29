// ============================================================
// Memory API
// ============================================================

import fs from 'fs/promises'
import path from 'path'
import { Hono } from 'hono'
import { getServerRuntime } from '../runtime'

const app = new Hono()

interface ScannedMemo {
  name: string
  description: string
  type: string
  content: string
  filePath: string
  lines: number
  sizeKb: number
  userId: string
}

interface EntrypointMemo {
  userId: string
  content: string
  filePath: string
}

/**
 * Parse frontmatter from memory markdown files
 * Format:
 * ---
 * name: <name>
 * description: <description>
 * type: user|feedback|project|reference
 * ---
 */
function parseFrontmatter(content: string): { data: Record<string, string>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null

  const raw = match[1]
  const body = match[2].trim()
  const data: Record<string, string> = {}

  for (const line of raw.split('\n')) {
    const sep = line.indexOf(':')
    if (sep > 0) {
      data[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
    }
  }

  return { data, body }
}

/**
 * Scan a single user memory directory for .md files with frontmatter
 */
async function scanUserMemoryDir(userMemoryDir: string, userId: string): Promise<ScannedMemo[]> {
  const results: ScannedMemo[] = []

  let files: string[]
  try {
    files = await fs.readdir(userMemoryDir)
  } catch {
    return results
  }

  for (const file of files) {
    if (!file.endsWith('.md') || file === 'MEMORY.md') continue

    const filePath = path.join(userMemoryDir, file)
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = parseFrontmatter(content)
      const lines = content.split('\n').length
      const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024

      results.push({
        name: parsed?.data?.name ?? path.basename(file, '.md'),
        description: parsed?.data?.description ?? '',
        type: parsed?.data?.type ?? 'user',
        content,
        filePath,
        lines,
        sizeKb,
        userId,
      })
    } catch {
      // skip unreadable files
    }
  }

  return results
}

/**
 * GET / — 获取所有记忆条目
 */
app.get('/', async (c) => {
  try {
    const runtime = await getServerRuntime()
    const memoryDir = runtime.layout.resources.memory[0]

    if (!memoryDir) {
      return c.json({ memory: [], entrypoints: [] })
    }

    // Scan user memory directories: users/*/memory/
    const usersDir = path.join(memoryDir, 'users')
    let userIds: string[] = []
    try {
      const entries = await fs.readdir(usersDir, { withFileTypes: true })
      userIds = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      // users dir not exists
    }

    const allMemories: ScannedMemo[] = []
    const entrypoints: EntrypointMemo[] = []

    for (const userId of userIds) {
      const userMemoryDir = path.join(usersDir, userId, 'memory')

      // Load MEMORY.md entrypoint
      const entrypointPath = path.join(userMemoryDir, 'MEMORY.md')
      try {
        const content = await fs.readFile(entrypointPath, 'utf-8')
        entrypoints.push({ userId, content, filePath: entrypointPath })
      } catch {
        // no MEMORY.md for this user
      }

      // Scan memory files
      const memos = await scanUserMemoryDir(userMemoryDir, userId)
      allMemories.push(...memos)
    }

    return c.json({
      memory: allMemories,
      entrypoints,
      baseDir: memoryDir,
    })
  } catch (error) {
    console.error('[Memory API] Error:', error)
    return c.json({ error: 'Failed to load memory' }, 500)
  }
})

export default app
