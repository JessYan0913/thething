import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import type { MemoryType, MemorySource } from './types';
import { isMemoryType, isMemorySource } from './frontmatter';
import { isTieredStorage, getTierDir, TIER_DIRS, type MemoryTier } from './tiered-storage';

export interface ScannedMemory {
  filename: string;
  filePath: string;
  name: string;
  description: string;
  type: MemoryType;
  mtimeMs: number;
  // Layer 2: 信任层
  source: MemorySource;
  confidence: number;
  // 语义检索增强
  subject: string;
  aliases: string[];
  context: string[];
  // 记忆正文（用于冲突检测）
  content: string;
  // 分层存储信息
  tier?: MemoryTier;
}

export async function scanMemoryFiles(memoryDir: string): Promise<ScannedMemory[]> {
  const memories: ScannedMemory[] = [];

  // 检查是否已迁移到分层存储
  const tiered = await isTieredStorage(memoryDir);

  if (tiered) {
    // 从分层目录扫描
    for (const tier of TIER_DIRS) {
      const tierDir = getTierDir(memoryDir, tier);
      try {
        const tierMemories = await scanDir(tierDir, tier);
        memories.push(...tierMemories);
      } catch {
        // tier dir may not exist
      }
    }
  } else {
    // 从扁平目录扫描（兼容旧格式）
    try {
      const flatMemories = await scanDir(memoryDir);
      memories.push(...flatMemories);
    } catch {
      // dir may not exist
    }
  }

  memories.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return memories.slice(0, 200);
}

/**
 * 扫描单个目录中的记忆文件
 */
async function scanDir(dir: string, tier?: MemoryTier): Promise<ScannedMemory[]> {
  const memories: ScannedMemory[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    const mdFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md')
      .map((entry) => entry.name);

    for (const filename of mdFiles) {
      const filePath = path.join(dir, filename);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const stat = await fs.stat(filePath);

        const parsed = matter(content);
        const { name, description, type, source, confidence, subject, aliases, context } = parsed.data as {
          name?: string;
          description?: string;
          type?: string;
          source?: string;
          confidence?: number;
          subject?: string;
          aliases?: string[];
          context?: string[];
        };

        if (!name || !type || !isMemoryType(type)) {
          continue;
        }

        memories.push({
          filename,
          filePath,
          name,
          description: description || '',
          type,
          mtimeMs: stat.mtimeMs,
          source: source && isMemorySource(source) ? source : 'explicit',
          confidence: confidence != null && !isNaN(confidence) ? confidence : 0.8,
          subject: subject || '',
          aliases: Array.isArray(aliases) ? aliases : [],
          context: Array.isArray(context) ? context : [],
          content: parsed.content.trim(),
          tier,
        });
      } catch {
        continue;
      }
    }
  } catch {
    // dir may not exist
  }

  return memories;
}

export async function readMemoryContent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}
