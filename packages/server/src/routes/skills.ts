// ============================================================
// Skills API
// ============================================================

import { Hono } from 'hono'
import { getServerContext, getServerRuntime, reloadServerContext } from '../runtime'
import { promises as fs } from 'fs'
import path from 'path'
import { clearSkillsCache } from '@the-thing/core'

const app = new Hono()

/**
 * GET / — 获取所有技能列表
 */
app.get('/', async (c) => {
  try {
    const context = await getServerContext()
    const skills = context.skills.map((skill) => {
      // 从 sourcePath 提取 folderName（技能文件夹的路径）
      const sourceDir = path.dirname(skill.sourcePath)
      return {
        name: skill.name,
        folderName: path.basename(sourceDir),
        description: skill.description,
        whenToUse: skill.whenToUse,
        allowedTools: skill.allowedTools,
        model: skill.model,
        effort: skill.effort,
        context: skill.context,
        paths: skill.paths,
        sourcePath: skill.sourcePath,
        source: skill.source ?? 'project',
      }
    })

    return c.json({ skills })
  } catch (error) {
    console.error('[Skills API] Error:', error)
    return c.json({ error: 'Failed to load skills' }, 500)
  }
})

// ============================================================
// Helpers
// ============================================================

/**
 * 获取主技能目录（project 级别，用于写入/删除）
 */
async function getPrimarySkillsDir(): Promise<string> {
  const runtime = await getServerRuntime()
  const dirs = runtime.layout.resources.skills
  return dirs[dirs.length - 1]
}

/**
 * 确保主技能目录存在
 */
async function ensureSkillsDir(): Promise<string> {
  const dir = await getPrimarySkillsDir()
  try {
    await fs.access(dir)
  } catch {
    await fs.mkdir(dir, { recursive: true })
  }
  return dir
}

/**
 * 从 SKILL.md 解析 name 和 description
 */
function parseSkillMd(content: string): { name: string; description: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/
  const match = content.match(frontmatterRegex)

  if (!match) {
    const nameMatch = content.match(/^#\s+(.+)/m)
    return { name: nameMatch?.[1]?.trim() || '', description: '' }
  }

  const frontmatter = match[1]
  const metadata: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      metadata[line.slice(0, colonIndex).trim()] = line.slice(colonIndex + 1).trim()
    }
  }

  return { name: metadata.name || '', description: metadata.description || '' }
}

/**
 * 递归搜索 SKILL.md（不区分大小写）
 */
async function findSkillMd(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        return fullPath
      }
      if (entry.isDirectory()) {
        const result = await findSkillMd(fullPath)
        if (result) return result
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * 递归构建文件树
 */
async function buildTree(dir: string, basePath: string): Promise<SkillFileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: SkillFileNode[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children: await buildTree(fullPath, basePath),
      })
    } else {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
      })
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

interface SkillFileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: SkillFileNode[]
}

// ============================================================
// POST /upload — 上传技能文件夹
// ============================================================

app.post('/upload', async (c) => {
  try {
    const body = await c.req.parseBody()
    const folderName = body.folderName as string
    const overwrite = body.overwrite === 'true'

    if (!folderName) {
      return c.json({ error: 'Missing folderName' }, 400)
    }

    const skillsDir = await ensureSkillsDir()
    const folderPath = path.join(skillsDir, folderName)

    // 检查是否已存在
    try {
      const stat = await fs.stat(folderPath)
      if (stat.isDirectory() && !overwrite) {
        return c.json({ error: 'Skill already exists' }, 409)
      }
    } catch {
      // 目录不存在，正常创建
    }

    // 创建目录
    await fs.mkdir(folderPath, { recursive: true })

    // 写入文件
    for (const [key, value] of Object.entries(body)) {
      if (!key.startsWith('files/') || !(value instanceof File)) continue

      // 从路径中提取相对路径（去掉 files/ 前缀和顶层文件夹名）
      const relativePath = key.slice('files/'.length)
      const parts = relativePath.split('/')
      const stripped = parts.length > 1 ? parts.slice(1).join('/') : parts[0]
      const filePath = path.join(folderPath, stripped)

      // 确保子目录存在
      const fileDir = path.dirname(filePath)
      await fs.mkdir(fileDir, { recursive: true })

      const buffer = await value.arrayBuffer()
      await fs.writeFile(filePath, Buffer.from(buffer))
    }

    await reloadServerContext()
    return c.json({ success: true })
  } catch (error) {
    console.error('[Skills API] Upload error:', error)
    return c.json({ error: 'Upload failed' }, 500)
  }
})

// ============================================================
// DELETE / — 删除技能
// ============================================================

app.delete('/', async (c) => {
  try {
    const name = c.req.query('name')
    if (!name) {
      return c.json({ error: 'Missing name parameter' }, 400)
    }

    const skillsDir = await getPrimarySkillsDir()
    const folderPath = path.join(skillsDir, name)

    try {
      await fs.access(folderPath)
    } catch {
      return c.json({ error: 'Skill not found' }, 404)
    }

    await fs.rm(folderPath, { recursive: true, force: true })
    clearSkillsCache()
    await reloadServerContext()
    return c.json({ success: true })
  } catch (error) {
    console.error('[Skills API] Delete error:', error)
    return c.json({ error: 'Delete failed' }, 500)
  }
})

// ============================================================
// GET /detail — 获取技能详情
// ============================================================

app.get('/detail', async (c) => {
  try {
    const name = c.req.query('name')
    if (!name) {
      return c.json({ error: 'Missing name parameter' }, 400)
    }

    const skillsDir = await getPrimarySkillsDir()
    const folderPath = path.join(skillsDir, name)

    try {
      const stat = await fs.stat(folderPath)
      if (!stat.isDirectory()) {
        return c.json({ error: 'Not a directory' }, 400)
      }
    } catch {
      return c.json({ error: 'Skill not found' }, 404)
    }

    const skillMdPath = await findSkillMd(folderPath)
    let displayName = name
    let description = ''

    if (skillMdPath) {
      const content = await fs.readFile(skillMdPath, 'utf-8')
      const parsed = parseSkillMd(content)
      if (parsed.name) displayName = parsed.name
      description = parsed.description
    }

    const tree = await buildTree(folderPath, folderPath)
    const skillMdRelativePath = skillMdPath ? path.relative(folderPath, skillMdPath).replace(/\\/g, '/') : undefined

    return c.json({
      folderName: name,
      name: displayName,
      description,
      tree,
      skillMdPath: skillMdRelativePath,
    })
  } catch (error) {
    console.error('[Skills API] Detail error:', error)
    return c.json({ error: 'Failed to get skill detail' }, 500)
  }
})

// ============================================================
// GET /file — 读取技能文件夹中的文件内容
// ============================================================

app.get('/file', async (c) => {
  try {
    const name = c.req.query('name')
    const filePath = c.req.query('path')
    if (!name || !filePath) {
      return c.json({ error: 'Missing name or path parameter' }, 400)
    }

    const skillsDir = await getPrimarySkillsDir()
    const resolvedPath = path.join(skillsDir, name, filePath)

    // 安全校验：防止路径穿越
    if (!resolvedPath.startsWith(skillsDir)) {
      return c.json({ error: 'Path not allowed' }, 403)
    }

    const stat = await fs.stat(resolvedPath)
    if (!stat.isFile()) {
      return c.json({ error: 'Not a file' }, 400)
    }

    const content = await fs.readFile(resolvedPath, 'utf-8')
    const ext = path.extname(resolvedPath).toLowerCase()
    return c.json({ content, ext })
  } catch (error) {
    console.error('[Skills API] File error:', error)
    return c.json({ error: 'File not found' }, 404)
  }
})

export default app
