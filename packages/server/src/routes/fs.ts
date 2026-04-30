// ============================================================
// File System API — 目录列表和文件读取
// 使用 CoreRuntime 的资源路径作为访问范围
// ============================================================

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { getServerRuntime } from '../runtime'

const app = new Hono()

/**
 * 获取允许访问的根目录列表（resourceRoot + 用户 home）
 */
async function getAllowedRoots(): Promise<string[]> {
  const runtime = await getServerRuntime()
  const resourceRoot = runtime.layout.resourceRoot
  const homeDir = os.homedir()
  return [resourceRoot, homeDir]
}

/**
 * 检查路径是否在允许范围内
 */
function isPathAllowed(resolved: string, allowedRoots: string[]): boolean {
  return allowedRoots.some(
    (root) => resolved.startsWith(root + path.sep) || resolved === root,
  )
}

/**
 * GET /list — 列出目录内容
 * Query: dir — 目录绝对路径
 */
app.get('/list', async (c) => {
  const dirParam = c.req.query('dir')
  if (!dirParam) {
    return c.json({ error: 'Missing dir query parameter' }, 400)
  }

  const resolvedDir = path.resolve(dirParam)
  const allowedRoots = await getAllowedRoots()
  if (!isPathAllowed(resolvedDir, allowedRoots)) {
    return c.json({ error: 'Path not allowed' }, 403)
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
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => {
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
 * Query: path — 文件绝对路径
 */
app.get('/read', async (c) => {
  const fileParam = c.req.query('path')
  if (!fileParam) {
    return c.json({ error: 'Missing path query parameter' }, 400)
  }

  const resolvedFile = path.resolve(fileParam)
  const allowedRoots = await getAllowedRoots()
  if (!isPathAllowed(resolvedFile, allowedRoots)) {
    return c.json({ error: 'Path not allowed' }, 403)
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
