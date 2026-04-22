import fs from 'fs/promises';
import path from 'path';
import { detectProjectDir } from '../paths';

// ============================================================================
// Memory Configuration
// ============================================================================

export interface MemoryConfig {
  /** Base directory for memory storage. Defaults to detectProjectDir() + '/.thething/memory' */
  baseDir?: string;
}

const DEFAULT_MEMORY_BASE_DIR = path.join(detectProjectDir(), '.thething', 'memory');

// 环境变量名称: THETHING_MEMORY_DIR
// 允许用户自定义项目内存存储目录
let configuredMemoryBaseDir: string =
  process.env.THETHING_MEMORY_DIR || DEFAULT_MEMORY_BASE_DIR;

/**
 * Configure the memory base directory.
 * Must be called before other memory operations.
 */
export function configureMemory(config: MemoryConfig): void {
  configuredMemoryBaseDir =
    config.baseDir || process.env.THETHING_MEMORY_DIR || DEFAULT_MEMORY_BASE_DIR;
}

export function getMemoryBaseDir(): string {
  return configuredMemoryBaseDir;
}

export function getUserMemoryDir(userId: string): string {
  return path.join(configuredMemoryBaseDir, 'users', userId, 'memory');
}

export function getTeamMemoryDir(teamId: string): string {
  return path.join(configuredMemoryBaseDir, 'teams', teamId, 'memory');
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