import fs from 'fs/promises';
import path from 'path';
import type { ResolvedLayout } from '../../config/layout';

export function getPrimaryMemoryDir(
  layout: Pick<ResolvedLayout, 'resources' | 'resourceRoot' | 'configDirName'>,
): string {
  return layout.resources.memory[layout.resources.memory.length - 1]
    ?? path.join(layout.resourceRoot, layout.configDirName, 'memory');
}

/**
 * Get user memory directory.
 *
 * @param userId - User ID
 * @param memoryBaseDir - Base memory directory
 */
export function getUserMemoryDir(userId: string, memoryBaseDir: string): string {
  return path.join(memoryBaseDir, 'users', userId, 'memory');
}

/**
 * Get team memory directory.
 *
 * @param teamId - Team ID
 * @param memoryBaseDir - Base memory directory
 */
export function getTeamMemoryDir(teamId: string, memoryBaseDir: string): string {
  return path.join(memoryBaseDir, 'teams', teamId, 'memory');
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
