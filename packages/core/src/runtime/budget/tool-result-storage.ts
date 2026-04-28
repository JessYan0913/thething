// ============================================================
// Tool Result Storage - 工具结果持久化存储
// ============================================================
// 参考 Claude Code toolResultStorage.ts
// 大工具输出持久化到磁盘，返回预览 + 文件路径
// ============================================================

import { mkdir, writeFile, readdir, stat, rm } from 'fs/promises'
import { join, dirname } from 'path'
import {
  PERSISTED_OUTPUT_TAG,
  PERSISTED_OUTPUT_CLOSING_TAG,
  PREVIEW_SIZE_CHARS,
  type PersistedToolResult,
} from './tool-output-manager'
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../config/defaults'

// ============================================================
// 存储目录配置
// ============================================================

/** 工具结果存储子目录名 */
export const TOOL_RESULTS_SUBDIR = 'tool-results'

/** 项目配置工作目录名（使用统一常量） */
export const THETHING_DIR = DEFAULT_PROJECT_CONFIG_DIR_NAME

// ============================================================
// 路径辅助函数
// ============================================================

/**
 * 获取工具结果存储目录
 */
export function getToolResultsDir(sessionId: string, projectDir: string): string {
  return join(projectDir, THETHING_DIR, TOOL_RESULTS_SUBDIR, sessionId)
}

/**
 * 获取单个工具结果文件路径
 */
export function getToolResultPath(
  toolUseId: string,
  sessionId: string,
  projectDir: string,
  isJson: boolean = false
): string {
  const ext = isJson ? 'json' : 'txt'
  return join(getToolResultsDir(sessionId, projectDir), `${toolUseId}.${ext}`)
}

// ============================================================
// 核心持久化函数
// ============================================================

/**
 * 持久化工具结果到磁盘
 *
 * @param content 工具结果内容
 * @param toolUseId 工具调用 ID
 * @param sessionId 会话 ID
 * @param projectDir 项目目录
 * @returns 持久化结果信息
 */
export async function persistToolResult(
  content: string,
  toolUseId: string,
  sessionId: string,
  projectDir: string
): Promise<PersistedToolResult> {
  // 确保目录存在
  const dir = getToolResultsDir(sessionId, projectDir)
  await ensureDir(dir)

  // 确定文件类型
  const isJson = content.trim().startsWith('{') || content.trim().startsWith('[')
  const filepath = getToolResultPath(toolUseId, sessionId, projectDir, isJson)

  // 写入文件（使用 'wx' 避免覆盖已存在的文件）
  try {
    await writeFile(filepath, content, { encoding: 'utf-8', flag: 'wx' })
    console.log(
      `[Tool Result Storage] Persisted ${toolUseId} to ${filepath} (${formatSize(content.length)})`
    )
  } catch (error: unknown) {
    const errno = getErrnoCode(error)
    if (errno !== 'EEXIST') {
      console.error('[Tool Result Storage] Write error:', error)
      throw error
    }
    // EEXIST: 文件已存在，跳过写入
    console.log(`[Tool Result Storage] File already exists: ${filepath}`)
  }

  // 生成预览
  const { preview, hasMore } = generatePreview(content, PREVIEW_SIZE_CHARS)

  return {
    filepath,
    originalSize: content.length,
    preview,
    hasMore,
  }
}

/**
 * 确保目录存在
 */
async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    // 目录可能已存在
  }
}

// ============================================================
// 预览生成
// ============================================================

/**
 * 生成内容预览
 * 在换行边界截断，避免切断行
 */
export function generatePreview(
  content: string,
  maxChars: number
): { preview: string; hasMore: boolean } {
  if (content.length <= maxChars) {
    return { preview: content, hasMore: false }
  }

  // 在换行边界截断
  const truncated = content.slice(0, maxChars)
  const lastNewline = truncated.lastIndexOf('\n')

  // 如果找到换行符且位置合理（超过限制的 50%），使用换行位置
  const cutPoint = lastNewline > maxChars * 0.5 ? lastNewline : maxChars

  return {
    preview: content.slice(0, cutPoint),
    hasMore: true,
  }
}

/**
 * 构建持久化输出消息
 * 参考 Claude Code 格式
 */
export function buildPersistedOutputMessage(result: PersistedToolResult, isTemporary: boolean = false): string {
  let message = `${PERSISTED_OUTPUT_TAG}\n`
  message += `Output size: ${formatSize(result.originalSize)}.\n`
  message += `Full output saved to: ${result.filepath}\n`
  if (isTemporary) {
    message += `\nNote: This is a temporary file. Copy it if you need to keep it.\n`
  } else {
    message += `\nYou can read the complete output using the read_file tool.\n`
  }
  message += `\nPreview (first ${formatSize(PREVIEW_SIZE_CHARS)}):\n`
  message += result.preview
  if (result.hasMore) {
    message += '\n...\n'
  }
  message += PERSISTED_OUTPUT_CLOSING_TAG
  return message
}

// ============================================================
// 清理函数
// ============================================================

/**
 * 清理会话的工具结果目录
 * 在会话结束时调用
 */
export async function cleanupSessionToolResults(
  sessionId: string,
  projectDir: string
): Promise<void> {
  const dir = getToolResultsDir(sessionId, projectDir)

  try {
    // 检查目录是否存在
    await stat(dir)

    // 删除整个目录
    await rm(dir, { recursive: true, force: true })
    console.log(`[Tool Result Storage] Cleaned up session ${sessionId} tool results`)
  } catch (error: unknown) {
    const errno = getErrnoCode(error)
    if (errno !== 'ENOENT') {
      console.warn(`[Tool Result Storage] Cleanup error:`, error)
    }
    // ENOENT: 目录不存在，无需清理
  }
}

/**
 * 清理所有超过指定天数的工具结果
 * 可用于定期清理
 */
export async function cleanupOldToolResults(
  projectDir: string,
  maxAgeDays: number = 7
): Promise<{ cleanedSessions: number; cleanedFiles: number }> {
  const toolResultsDir = join(projectDir, THETHING_DIR, TOOL_RESULTS_SUBDIR)

  try {
    const sessions = await readdir(toolResultsDir)
    const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    let cleanedSessions = 0
    let cleanedFiles = 0

    for (const sessionId of sessions) {
      const sessionDir = join(toolResultsDir, sessionId)
      try {
        const sessionStat = await stat(sessionDir)

        if (sessionStat.mtimeMs < cutoffTime) {
          await rm(sessionDir, { recursive: true, force: true })
          cleanedSessions++

          // 估算文件数（从目录名推断）
          const files = await readdir(sessionDir).catch(() => [])
          cleanedFiles += files.length
        }
      } catch {
        // 跳过无法访问的目录
      }
    }

    if (cleanedSessions > 0) {
      console.log(
        `[Tool Result Storage] Cleaned ${cleanedSessions} old sessions, ~${cleanedFiles} files`
      )
    }

    return { cleanedSessions, cleanedFiles }
  } catch (error: unknown) {
    const errno = getErrnoCode(error)
    if (errno !== 'ENOENT') {
      console.warn(`[Tool Result Storage] Cleanup old results error:`, error)
    }
    return { cleanedSessions: 0, cleanedFiles: 0 }
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 获取错误码
 */
function getErrnoCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code: string }).code
  }
  return undefined
}

/**
 * 格式化文件大小
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// ============================================================
// 类型导出
// ============================================================

export type {
  PersistedToolResult,
  ContentReplacementState,
  ContentReplacementRecord,
} from './tool-output-manager'