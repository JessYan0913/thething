import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import type { MemoryType } from './types';

export interface ScannedMemory {
  filename: string;
  filePath: string;
  name: string;
  description: string;
  type: MemoryType;
  mtimeMs: number;
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
        const { name, description, type } = parsed.data as {
          name?: string;
          description?: string;
          type?: string;
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

export async function readMemoryContent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}
