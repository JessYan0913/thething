// ============================================================
// Memory Loader
// ============================================================
//
// 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
// 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。
//
// 重要变更（2026-04）：
// - MEMORY_MD_MAX_LINES 已迁移到 BehaviorConfig.memory.mdMaxLines
// - MEMORY_MD_MAX_SIZE_KB 已迁移到 BehaviorConfig.memory.mdMaxSizeKb
// - 调用方可通过 options.maxLines/maxSizeKb 传入配置
// - 未传入时使用 defaults.ts 作为 fallback

import fs from 'fs/promises';
import path from 'path';
import { parseFrontmatterFile } from '../../foundation/parser';
import { LoadingCache } from '../../foundation/scanner';
import { getProjectConfigDir } from '../../foundation/paths';
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
  /** 显式扫描目录（来自 ResolvedLayout.resources.memory） */
  dirs?: readonly string[];
  /** MEMORY.md 最大行数（来自 BehaviorConfig.memory.mdMaxLines） */
  maxLines?: number;
  /** MEMORY.md 最大大小 KB（来自 BehaviorConfig.memory.mdMaxSizeKb） */
  maxSizeKb?: number;
}

// ============================================================
// 加载函数
// ============================================================

/**
 * 加载 Memory 配置
 *
 * 注意：configDirName 从全局单例 getResolvedConfigDirName() 获取
 *
 * @param options 加载选项（maxLines/maxSizeKb 可从 BehaviorConfig.memory 传入）
 * @returns MemoryEntry 列表
 */
export async function loadMemory(options?: LoadMemoryOptions): Promise<MemoryEntry[]> {
  const cwd = options?.cwd ?? process.cwd();
  // 使用传入的限制，否则使用 fallback
  const maxLines = options?.maxLines ?? MEMORY_MD_MAX_LINES;
  const maxSizeKb = options?.maxSizeKb ?? MEMORY_MD_MAX_SIZE_KB;
  const dirs = options?.dirs ? [...options.dirs] : [getProjectConfigDir(cwd, 'memory')];

  // 检查缓存（包含限制参数）
  const cacheKey = `memory:${cwd}:${dirs.join('|')}:${maxLines}:${maxSizeKb}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 加载 MEMORY.md
  const entries: MemoryEntry[] = [];

  for (const memoryDir of dirs) {
    const memoryFile = path.join(memoryDir, 'MEMORY.md');
    try {
      const content = await fs.readFile(memoryFile, 'utf-8');
      const lines = content.split('\n').length;
      const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024;

      // 截断超长内容
      const truncatedContent = truncateContent(content, lines, sizeKb, maxLines, maxSizeKb);

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

          const truncatedContent = truncateContent(content, lines, sizeKb, maxLines, maxSizeKb);

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
  }

  // 更新缓存
  memoryCache.set(cacheKey, entries);

  return entries;
}

/**
 * 截断超长内容
 *
 * @param content 原始内容
 * @param lines 当前行数
 * @param sizeKb 当前大小 KB
 * @param maxLines 最大行数限制
 * @param maxSizeKb 最大大小限制 KB
 */
function truncateContent(
  content: string,
  lines: number,
  sizeKb: number,
  maxLines: number,
  maxSizeKb: number,
): string {
  // 检查行数
  if (lines > maxLines) {
    const contentLines = content.split('\n');
    content = contentLines.slice(0, maxLines).join('\n');
    console.warn(`[MemoryLoader] Truncated ${lines} lines to ${maxLines}`);
  }

  // 检查大小
  if (sizeKb > maxSizeKb) {
    const maxBytes = maxSizeKb * 1024;
    content = content.slice(0, maxBytes);
    console.warn(`[MemoryLoader] Truncated ${sizeKb}KB to ${maxSizeKb}KB`);
  }

  return content;
}

/**
 * 清除缓存
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}
