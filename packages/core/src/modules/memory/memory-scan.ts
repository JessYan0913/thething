import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import type { MemoryType, MemorySource } from './types';

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
}

export async function scanMemoryFiles(memoryDir: string): Promise<ScannedMemory[]> {
  try {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });

    const mdFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md')
      .map((entry) => entry.name);

    const memories: ScannedMemory[] = [];

    for (const filename of mdFiles) {
      const filePath = path.join(memoryDir, filename);

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
          source: isMemorySource(source) ? source : 'explicit',
          confidence: confidence != null && !isNaN(confidence) ? confidence : 0.8,
          subject: subject || '',
          aliases: Array.isArray(aliases) ? aliases : [],
          context: Array.isArray(context) ? context : [],
        });
      } catch {
        continue;
      }
    }

    memories.sort((a, b) => b.mtimeMs - a.mtimeMs);

    return memories.slice(0, 200);
  } catch {
    return [];
  }
}

function isMemoryType(type: string): type is MemoryType {
  return ['user', 'feedback', 'project', 'reference'].includes(type);
}

function isMemorySource(source: string | undefined): source is MemorySource {
  return source === 'explicit' || source === 'inferred' || source === 'promoted';
}

export async function readMemoryContent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}
