// ============================================================
// Memory IO - 记忆条目读写
// ============================================================

import fs from 'fs/promises'
import path from 'path'

export type MemoryType = 'preference' | 'identity' | 'correction' | 'explicit'

export interface MemoryEntry {
  id: string
  content: string
  type: MemoryType
  /**
   * 来源引用（可选）：这条记忆来自哪里——用户原话或来源上下文。
   * 用于归因与防幻觉（每条记忆可追溯到源头），不用于存储知识本身。
   */
  source?: string
  /**
   * 语义域（可选）：同一 dimension 下的记忆属于同类属性。
   * 单值属性（如 display-format、language）写入同名 dimension，LLM 可识别同域冲突；
   * 多值属性（如 food、interests）不填或填相同 dimension 表示累加共存。
   */
  dimension?: string
  /**
   * 重要性（可选，1-10）：检索打分用。缺省时按 type 派生默认值。
   */
  importance?: number
  pinned: boolean
  created: string
  updated: string
}

// ============================================================
// 序列化 / 反序列化
// ============================================================

function serialize(entry: MemoryEntry): string {
  const lines = [
    '---',
    `id: ${entry.id}`,
    `type: ${entry.type}`,
  ]
  if (entry.dimension) lines.push(`dimension: ${entry.dimension}`)
  if (entry.source) lines.push(`source: ${entry.source}`)
  if (entry.importance !== undefined) lines.push(`importance: ${entry.importance}`)
  lines.push(
    `pinned: ${entry.pinned}`,
    `created: ${entry.created}`,
    `updated: ${entry.updated}`,
    '---',
    entry.content,
  )
  return lines.join('\n')
}

function deserialize(raw: string, fallbackId: string): MemoryEntry | null {
  try {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/m)
    if (!match) return null
    const [, frontmatter, content] = match
    const get = (key: string) =>
      frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
    return {
      id: get('id') || fallbackId,
      content: content.trim(),
      type: (get('type') as MemoryType) || 'explicit',
      dimension: get('dimension') || undefined,
      source: get('source') || undefined,
      importance: get('importance') ? Number(get('importance')) : undefined,
      pinned: get('pinned') === 'true',
      created: get('created') || new Date().toISOString(),
      updated: get('updated') || new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ============================================================
// 简单 nanoid（16 chars，无外部依赖）
// ============================================================

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// ============================================================
// Public API
// ============================================================

export async function ensureMemoryDirExists(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function writeMemory(
  dir: string,
  input: { content: string; type: MemoryType; dimension?: string; source?: string; importance?: number; pinned?: boolean },
): Promise<string> {
  await ensureMemoryDirExists(dir)
  const id = generateId()
  const now = new Date().toISOString()
  const entry: MemoryEntry = {
    id,
    content: input.content.trim(),
    type: input.type,
    dimension: input.dimension,
    source: input.source,
    importance: input.importance,
    pinned: input.pinned ?? false,
    created: now,
    updated: now,
  }
  await fs.writeFile(path.join(dir, `${id}.md`), serialize(entry), 'utf-8')
  return id
}

export async function readAllMemories(dir: string): Promise<MemoryEntry[]> {
  try {
    const files = await fs.readdir(dir)
    const mdFiles = files.filter(f => f.endsWith('.md'))
    const entries = await Promise.all(
      mdFiles.map(async (file) => {
        const raw = await fs.readFile(path.join(dir, file), 'utf-8')
        return deserialize(raw, file.replace(/\.md$/, ''))
      }),
    )
    const valid = entries.filter((e): e is MemoryEntry => e !== null)
    // pinned 优先，其余按创建时间倒序
    valid.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.created.localeCompare(a.created)
    })
    return valid
  } catch {
    return []
  }
}

export async function deleteMemory(dir: string, id: string): Promise<void> {
  // 只允许纯字母数字 id，防止路径穿越
  if (!/^[a-z0-9]+$/i.test(id)) {
    throw new Error(`Invalid memory id: ${id}`)
  }
  await fs.unlink(path.join(dir, `${id}.md`))
}

export async function updateMemory(dir: string, id: string, content: string): Promise<void> {
  if (!/^[a-z0-9]+$/i.test(id)) {
    throw new Error(`Invalid memory id: ${id}`)
  }
  const filePath = path.join(dir, `${id}.md`)
  const raw = await fs.readFile(filePath, 'utf-8')
  const entry = deserialize(raw, id)
  if (!entry) throw new Error(`Memory ${id} could not be parsed`)
  entry.content = content.trim()
  entry.updated = new Date().toISOString()
  await fs.writeFile(filePath, serialize(entry), 'utf-8')
}
