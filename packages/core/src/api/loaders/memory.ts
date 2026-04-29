// ============================================================
// Memory Loader
// ============================================================

import fs from 'fs/promises';
import path from 'path';
import { parseFrontmatterFile } from '../../foundation/parser';
import { LoadingCache } from '../../foundation/scanner';
import { computeProjectConfigDir } from '../../foundation/paths';
import { MEMORY_MD_MAX_LINES, MEMORY_MD_MAX_SIZE_KB } from '../../config/defaults';

// ============================================================
// 类型
// ============================================================

export interface MemoryEntry {
  content: string;
  filePath: string;
  lines: number;
  sizeKb: number;
}

// ============================================================
// 缓存
// ============================================================

const memoryCache = new LoadingCache<MemoryEntry[]>();

// ============================================================
// 加载选项
// ============================================================

export interface LoadMemoryOptions {
  cwd?: string;
  /** 配置目录名（可选，默认 '.thething'） */
  configDirName?: string;
}

// ============================================================
// 加载函数
// ============================================================

/**
 * 加载 Memory 配置
 *
 * @param options 加载选项
 * @returns MemoryEntry 列表
 */
export async function loadMemory(options?: LoadMemoryOptions): Promise<MemoryEntry[]> {
  const cwd = options?.cwd ?? process.cwd();
  const configDirName = options?.configDirName ?? '.thething';

  // 检查缓存
  const cacheKey = `memory:${cwd}:${configDirName}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const memoryDir = computeProjectConfigDir(cwd, 'memory', configDirName);

  // 加载 MEMORY.md
  const entries: MemoryEntry[] = [];

  const memoryFile = path.join(memoryDir, 'MEMORY.md');
  try {
    const content = await fs.readFile(memoryFile, 'utf-8');
    const lines = content.split('\n').length;
    const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024;

    // 截断超长内容
    const truncatedContent = truncateContent(content, lines, sizeKb);

    entries.push({
      content: truncatedContent,
      filePath: memoryFile,
      lines: truncatedContent.split('\n').length,
      sizeKb: Buffer.byteLength(truncatedContent, 'utf-8') / 1024,
    });
  } catch {
    // MEMORY.md 不存在
  }

  // 加载 memories/ 目录下的其他文件
  const memoriesDir = path.join(memoryDir, 'memories');
  try {
    const files = await fs.readdir(memoriesDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(memoriesDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').length;
        const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024;

        const truncatedContent = truncateContent(content, lines, sizeKb);

        entries.push({
          content: truncatedContent,
          filePath,
          lines: truncatedContent.split('\n').length,
          sizeKb: Buffer.byteLength(truncatedContent, 'utf-8') / 1024,
        });
      } catch {
        // 单个文件读取失败
      }
    }
  } catch {
    // memories/ 目录不存在
  }

  // 更新缓存
  memoryCache.set(cacheKey, entries);

  return entries;
}

/**
 * 截断超长内容
 */
function truncateContent(content: string, lines: number, sizeKb: number): string {
  // 检查行数
  if (lines > MEMORY_MD_MAX_LINES) {
    const contentLines = content.split('\n');
    content = contentLines.slice(0, MEMORY_MD_MAX_LINES).join('\n');
    console.warn(`[MemoryLoader] Truncated ${lines} lines to ${MEMORY_MD_MAX_LINES}`);
  }

  // 检查大小
  if (sizeKb > MEMORY_MD_MAX_SIZE_KB) {
    const maxBytes = MEMORY_MD_MAX_SIZE_KB * 1024;
    content = content.slice(0, maxBytes);
    console.warn(`[MemoryLoader] Truncated ${sizeKb}KB to ${MEMORY_MD_MAX_SIZE_KB}KB`);
  }

  return content;
}

/**
 * 清除缓存
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}