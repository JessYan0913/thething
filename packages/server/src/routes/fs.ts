// ============================================================
// File System API — 安全的目录列表和文件读取
// 仅允许访问项目根目录下的文件
// ============================================================

import { promises as fs } from 'fs'
import path from 'path'
import { Hono } from 'hono'
import { getServerProjectDir } from '../config'

const app = new Hono()

const PROJECT_DIR = getServerProjectDir()

/**
 * 确保路径在项目目录范围内，防止路径穿越
 */
function safeResolve(target: string): string | null {
  const resolved = path.resolve(target)
  if (!resolved.startsWith(PROJECT_DIR + path.sep) && resolved !== PROJECT_DIR) {
    return null
  }
  return resolved
}

/**
 * GET /list — 列出目录内容
 * Query: dir — 目录路径（绝对路径，须在项目目录内）
 */
app.get('/list', async (c) => {
  const dirParam = c.req.query('dir')
  if (!dirParam) {
    return c.json({ error: 'Missing dir query parameter' }, 400)
  }

  const resolvedDir = safeResolve(dirParam)
  if (!resolvedDir) {
    return c.json({ error: 'Path outside project directory' }, 403)
  }

  try {
    await fs.access(resolvedDir)
  } catch {
    return c.json({ error: 'Directory not found' }, 404)
  }

  const stat = await fs.stat(resolvedDir)
  if (!stat.isDirectory()) {
    return c.json({ error: 'Path is not a directory' }, 400)
  }

  const entries = await fs.readdir(resolvedDir, { withFileTypes: true })
  const items = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith('.')) // 跳过隐藏文件
      .sort((a, b) => {
        // 目录在前，文件在后，按名称排序
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
      .map(async (e) => {
        const fullPath = path.join(resolvedDir, e.name)
        let size = 0
        if (e.isFile()) {
          try {
            const fstat = await fs.stat(fullPath)
            size = fstat.size
          } catch { /* ignore */ }
        }
        return {
          name: e.name,
          path: fullPath,
          type: e.isDirectory() ? 'dir' : 'file',
          size,
        }
      })
  )

  return c.json({ items, parent: path.dirname(resolvedDir) })
})

/**
 * GET /read — 读取文件内容
 * Query: path — 文件路径（绝对路径，须在项目目录内）
 */
app.get('/read', async (c) => {
  const fileParam = c.req.query('path')
  if (!fileParam) {
    return c.json({ error: 'Missing path query parameter' }, 400)
  }

  const resolvedFile = safeResolve(fileParam)
  if (!resolvedFile) {
    return c.json({ error: 'Path outside project directory' }, 403)
  }

  try {
    await fs.access(resolvedFile)
  } catch {
    return c.json({ error: 'File not found' }, 404)
  }

  const stat = await fs.stat(resolvedFile)
  if (!stat.isFile()) {
    return c.json({ error: 'Path is not a file' }, 400)
  }

  const content = await fs.readFile(resolvedFile, 'utf-8')
  const ext = path.extname(resolvedFile).toLowerCase()

  return c.json({
    content,
    ext,
    size: stat.size,
    lines: content.split('\n').length,
  })
})

export default app
