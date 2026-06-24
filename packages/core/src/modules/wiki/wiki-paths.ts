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
 * 获取用户 wiki 目录
 * 路径: {wikiBaseDir}/users/{userId}
 */
export function getUserWikiDir(userId: string, wikiBaseDir: string): string {
  return path.join(wikiBaseDir, 'users', userId)
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
 * 将页面名称转换为 kebab-case 文件名
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
