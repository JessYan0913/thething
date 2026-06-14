// ============================================================
// Tiered Storage - 按稳定性分层存储
// ============================================================
// 管理 identity/pattern/state 三层目录结构

import fs from 'fs/promises'
import path from 'path'
import type { MemoryFileData, MemoryType } from './types'
import { parseMemoryFrontmatter, formatMemoryFrontmatter, isMemoryType } from './frontmatter'
import { logger } from '../../primitives/logger'

// ============================================================
// 类型定义
// ============================================================

export type MemoryTier = 'identity' | 'pattern' | 'state'

export interface TierIndex {
  version: number
  updatedAt: string
  memories: TierIndexEntry[]
}

export interface TierIndexEntry {
  filename: string
  tier: MemoryTier
  name: string
  type: string
  confidence: number
  source: string
  mtimeMs: number
}

// ============================================================
// 常量
// ============================================================

export const TIER_DIRS: MemoryTier[] = ['identity', 'pattern', 'state']
export const META_DIR = '_meta'
export const INDEX_FILE = 'index.json'
export const LEGACY_DIR = '_legacy'

// ============================================================
// 路径工具
// ============================================================

/**
 * 获取分层目录路径
 */
export function getTierDir(memoryDir: string, tier: MemoryTier): string {
  return path.join(memoryDir, tier)
}

/**
 * 获取元数据目录路径
 */
export function getMetaDir(memoryDir: string): string {
  return path.join(memoryDir, META_DIR)
}

/**
 * 获取索引文件路径
 */
export function getIndexFilePath(memoryDir: string): string {
  return path.join(memoryDir, META_DIR, INDEX_FILE)
}

/**
 * 检查是否已迁移到分层存储
 */
export async function isTieredStorage(memoryDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(memoryDir, META_DIR))
    return true
  } catch {
    return false
  }
}

// ============================================================
// 稳定性分类
// ============================================================

/**
 * 根据 frontmatter 的 stability 字段确定存储层级
 * 旧文件（无 stability 字段）默认放入 state 层
 */
export function determineTier(data: MemoryFileData): MemoryTier {
  if (data.stability === 'identity') return 'identity'
  if (data.stability === 'pattern') return 'pattern'
  return 'state'
}

// ============================================================
// 初始化分层目录
// ============================================================

/**
 * 初始化分层存储目录结构
 */
export async function initTieredDirs(memoryDir: string): Promise<void> {
  const dirs = [
    ...TIER_DIRS.map((t) => getTierDir(memoryDir, t)),
    getMetaDir(memoryDir),
  ]

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true })
  }
}

// ============================================================
// 迁移：扁平 → 分层
// ============================================================

/**
 * 迁移扁平目录到分层目录
 * 非破坏性：保留原文件在 _legacy 目录
 */
export async function migrateToTiered(
  memoryDir: string,
  options: { dryRun?: boolean } = {},
): Promise<{ migrated: number; skipped: number; errors: string[] }> {
  const { dryRun = false } = options
  const result = { migrated: 0, skipped: 0, errors: [] as string[] }

  // 读取扁平目录中的所有 .md 文件
  let files: string[]
  try {
    files = await fs.readdir(memoryDir)
  } catch {
    return result
  }

  const mdFiles = files.filter(
    (f) => f.endsWith('.md') && f !== 'MEMORY.md' && !TIER_DIRS.includes(f as MemoryTier),
  )

  if (mdFiles.length === 0) {
    return result
  }

  // 初始化分层目录
  if (!dryRun) {
    await initTieredDirs(memoryDir)
  }

  // 创建 _legacy 目录用于回退
  const legacyDir = path.join(memoryDir, LEGACY_DIR)
  if (!dryRun) {
    await fs.mkdir(legacyDir, { recursive: true })
  }

  for (const file of mdFiles) {
    const filePath = path.join(memoryDir, file)
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const data = parseMemoryFrontmatter(content)

      if (!data) {
        result.errors.push(`Failed to parse frontmatter: ${file}`)
        continue
      }

      const tier = determineTier(data)
      const tierDir = getTierDir(memoryDir, tier)
      const destPath = path.join(tierDir, file)

      if (dryRun) {
        result.migrated++
        continue
      }

      // 复制文件到分层目录
      await fs.copyFile(filePath, destPath)

      // 移动原文件到 _legacy
      await fs.rename(filePath, path.join(legacyDir, file))

      result.migrated++
    } catch (err) {
      result.errors.push(`Error migrating ${file}: ${err}`)
    }
  }

  // 生成索引
  if (!dryRun && result.migrated > 0) {
    await rebuildIndex(memoryDir)
  }

  return result
}

// ============================================================
// 索引管理
// ============================================================

/**
 * 重建 index.json
 */
export async function rebuildIndex(memoryDir: string): Promise<void> {
  const index: TierIndex = {
    version: 1,
    updatedAt: new Date().toISOString(),
    memories: [],
  }

  for (const tier of TIER_DIRS) {
    const tierDir = getTierDir(memoryDir, tier)
    try {
      const files = await fs.readdir(tierDir)
      const mdFiles = files.filter((f) => f.endsWith('.md'))

      for (const file of mdFiles) {
        const filePath = path.join(tierDir, file)
        try {
          const content = await fs.readFile(filePath, 'utf-8')
          const stat = await fs.stat(filePath)
          const data = parseMemoryFrontmatter(content)

          if (data) {
            index.memories.push({
              filename: file,
              tier,
              name: data.name,
              type: data.type,
              confidence: data.confidence ?? 0.8,
              source: data.source ?? 'explicit',
              mtimeMs: stat.mtimeMs,
            })
          }
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // tier dir may not exist yet
    }
  }

  const indexPath = getIndexFilePath(memoryDir)
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8')
}

/**
 * 加载索引
 */
export async function loadIndex(memoryDir: string): Promise<TierIndex | null> {
  const indexPath = getIndexFilePath(memoryDir)
  try {
    const content = await fs.readFile(indexPath, 'utf-8')
    return JSON.parse(content) as TierIndex
  } catch {
    return null
  }
}

// ============================================================
// 写入操作（写入分层目录）
// ============================================================

/**
 * 写入记忆文件到正确的层级目录
 */
export async function writeMemoryToTier(
  memoryDir: string,
  data: MemoryFileData,
  content: string,
): Promise<{ tier: MemoryTier; filePath: string }> {
  const tier = determineTier(data)
  const tierDir = getTierDir(memoryDir, tier)

  await fs.mkdir(tierDir, { recursive: true })

  const fileName = `${data.type}_${data.name.replace(/[^a-zA-Z0-9_一-鿿-]/g, '_').toLowerCase()}.md`
  const filePath = path.join(tierDir, fileName)

  const fileContent = formatMemoryFrontmatter(data) + '\n\n' + content
  await fs.writeFile(filePath, fileContent, 'utf-8')

  // 更新索引
  await rebuildIndex(memoryDir)

  return { tier, filePath }
}

/**
 * 删除记忆文件（从分层目录）
 */
export async function deleteMemoryFromTier(
  memoryDir: string,
  filename: string,
): Promise<boolean> {
  for (const tier of TIER_DIRS) {
    const tierDir = getTierDir(memoryDir, tier)
    const filePath = path.join(tierDir, filename)
    try {
      await fs.access(filePath)
      await fs.unlink(filePath)
      await rebuildIndex(memoryDir)
      return true
    } catch {
      // not in this tier, continue
    }
  }
  return false
}
