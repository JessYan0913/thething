// ============================================================
// Wiki Paths - 路径工具
// ============================================================

import fs from 'fs/promises'
import path from 'path'
import type { ResolvedLayout } from '../../services/config/layout'

/**
 * 获取主存储目录（从 layout 配置）
 * 路径: ~/.thething/wiki
 */
export function getPrimaryWikiDir(
  layout: Pick<ResolvedLayout, 'resources' | 'resourceRoot' | 'configDirName'>,
): string {
  return layout.resources.wiki[0]
    ?? path.join(layout.resourceRoot, layout.configDirName, 'wiki')
}

/**
 * 确保 wiki 目录存在
 */
export async function ensureWikiDirExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err
    }
  }
}

/**
 * 将页面名称转换为 kebab-case 文件名（仅文件名，不含目录）
 */
export function pageNameToFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9一-鿿-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    + '.md'
}

/**
 * 将分类名规范化为目录路径（支持多级，如 domain/finance → domain/finance）
 * 每段独立 kebab-case 化，`/` 保留为目录分隔符。
 */
export function categoryToDir(category: string): string {
  return category
    .split('/')
    .map(seg => seg
      .replace(/[^a-zA-Z0-9一-鿿-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase())
    .filter(Boolean)
    .join('/')
}

/**
 * 根据 name + category 生成带目录的相对路径：category/name.md
 */
export function pagePathFromData(name: string, category: string): string {
  return categoryToDir(category) + '/' + pageNameToFilename(name)
}

/**
 * 从文件名还原页面名称（移除 .md 后缀，将 - 还原为空格）
 */
export function filenameToPageName(filename: string): string {
  return filename
    .replace(/\.md$/, '')
    .replace(/-/g, ' ')
}

/**
 * 检查目录是否存在
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * 检查文件是否存在
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
