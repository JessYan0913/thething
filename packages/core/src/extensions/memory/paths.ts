import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../config/defaults';

// ============================================================================
// Memory Configuration
// ============================================================================

export interface MemoryConfig {
  /** Base directory for memory storage. Defaults to cwd/${DEFAULT_PROJECT_CONFIG_DIR_NAME}/memory */
  baseDir?: string;
  /** Project directory (cwd), used to compute default baseDir */
  cwd?: string;
}

// 环境变量名称: THETHING_MEMORY_DIR
// 允许用户自定义项目内存存储目录
let configuredMemoryBaseDir: string | null = null;

/**
 * Configure the memory base directory.
 * Must be called before other memory operations if custom path needed.
 */
export function configureMemory(config: MemoryConfig): void {
  const cwd = config.cwd ?? process.cwd();
  const defaultBaseDir = path.join(cwd, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'memory');
  configuredMemoryBaseDir =
    config.baseDir || process.env.THETHING_MEMORY_DIR || defaultBaseDir;
}

/**
 * Get memory base directory.
 * If not configured, computes from cwd parameter or process.cwd().
 *
 * @param cwd - Project directory (optional, defaults to process.cwd())
 */
export function getMemoryBaseDir(cwd?: string): string {
  if (configuredMemoryBaseDir) {
    return configuredMemoryBaseDir;
  }
  // 未配置时，使用 cwd 参数计算
  const effectiveCwd = cwd ?? process.cwd();
  return process.env.THETHING_MEMORY_DIR || path.join(effectiveCwd, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'memory');
}

/**
 * Get user memory directory.
 *
 * @param userId - User ID
 * @param cwd - Project directory (optional)
 */
export function getUserMemoryDir(userId: string, cwd?: string): string {
  return path.join(getMemoryBaseDir(cwd), 'users', userId, 'memory');
}

/**
 * Get team memory directory.
 *
 * @param teamId - Team ID
 * @param cwd - Project directory (optional)
 */
export function getTeamMemoryDir(teamId: string, cwd?: string): string {
  return path.join(getMemoryBaseDir(cwd), 'teams', teamId, 'memory');
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