import fs from 'fs/promises';
import path from 'path';

const MEMORY_BASE_DIR = process.env.MEMORY_BASE_DIR || path.join(process.cwd(), '.thething', 'memory');

export function getMemoryBaseDir(): string {
  return MEMORY_BASE_DIR;
}

export function getUserMemoryDir(userId: string): string {
  return path.join(MEMORY_BASE_DIR, 'users', userId, 'memory');
}

export function getTeamMemoryDir(teamId: string): string {
  return path.join(MEMORY_BASE_DIR, 'teams', teamId, 'memory');
}

export async function ensureMemoryDirExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
  }
}

export function isPathWithinMemoryDir(filePath: string, memoryDir: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedBase = path.resolve(memoryDir);
  return resolved.startsWith(resolvedBase);
}

export function sanitizeMemoryFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

export function getMemoryFilePath(memoryDir: string, type: string, name: string): string {
  const sanitizedName = sanitizeMemoryFilename(name);
  return path.join(memoryDir, `${type}_${sanitizedName}.md`);
}

export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
