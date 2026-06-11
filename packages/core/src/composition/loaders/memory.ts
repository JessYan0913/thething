// ============================================================
// Memory Loader
// ============================================================

import fs from 'fs/promises';
import path from 'path';
import { computeProjectConfigDir } from '../../primitives/paths';
import {
  MEMORY_MD_MAX_LINES,
  MEMORY_MD_MAX_SIZE_KB,
} from '../../services/config/defaults';
import { logger } from '../../primitives/logger';

// ============================================================
// 类型（重新导出自 modules/memory/types）
// ============================================================

export type { MemoryEntry } from '../../modules/memory/types';
import type { MemoryEntry } from '../../modules/memory/types';

// ============================================================
// 加载选项
// ============================================================

export interface LoadMemoryOptions {
  cwd?: string;
  /** 显式扫描目录（来自 ResolvedLayout.resources.memory） */
  dirs?: readonly string[];
  /** 配置目录路径（如 ~/.thething，用于计算默认目录） */
  configDir?: string;
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
 * 每次调用都从磁盘重新加载，确保始终读到最新状态。
 */
export async function loadMemory(options?: LoadMemoryOptions): Promise<MemoryEntry[]> {
  const cwd = options?.cwd ?? process.cwd();
  const configDir = options?.configDir;
  if (!configDir) throw new Error('loadMemory: configDir is required');
  const maxLines = options?.maxLines ?? MEMORY_MD_MAX_LINES;
  const maxSizeKb = options?.maxSizeKb ?? MEMORY_MD_MAX_SIZE_KB;
  const dirs = options?.dirs ? [...options.dirs] : [computeProjectConfigDir(cwd, 'memory', configDir)];

  const entries: MemoryEntry[] = [];

  for (const memoryDir of dirs) {
    const memoryFile = path.join(memoryDir, 'MEMORY.md');
    try {
      const content = await fs.readFile(memoryFile, 'utf-8');
      const lines = content.split('\n').length;
      const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024;

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

  return entries;
}

function truncateContent(
  content: string,
  lines: number,
  sizeKb: number,
  maxLines: number,
  maxSizeKb: number,
): string {
  if (lines > maxLines) {
    const contentLines = content.split('\n');
    content = contentLines.slice(0, maxLines).join('\n');
    logger.warn('MemoryLoader', `Truncated ${lines} lines to ${maxLines}`);
  }

  if (sizeKb > maxSizeKb) {
    const maxBytes = maxSizeKb * 1024;
    content = content.slice(0, maxBytes);
    logger.warn('MemoryLoader', `Truncated ${sizeKb}KB to ${maxSizeKb}KB`);
  }

  return content;
}
