// ============================================================
// Scanner - 目录扫描
// ============================================================

import fs from 'fs/promises';
import path from 'path';
import { getUserConfigDir } from '../paths';

// ============================================================
// 扫描配置
// ============================================================

export interface ScanOptions {
  /** 文件匹配模式（如 '*.md', '*.json'） */
  pattern: string;
  /** 是否递归扫描 */
  recursive?: boolean;
}

export interface ScanConfig {
  /** 扫描目录列表（相对或绝对路径） */
  dirs: string[];
  /** 文件匹配模式（如 '*.md', 'SKILL.md'） */
  filePattern: string;
  /** 目录名匹配模式（如 '*'，用于目录格式如 skill-name/SKILL.md） */
  dirPattern?: string;
  /** 是否递归扫描 */
  recursive?: boolean;
}

export interface ScanResult {
  /** 文件绝对路径 */
  filePath: string;
  /** 文件所在目录 */
  dirPath: string;
  /** 来源标识 */
  source: 'user' | 'project';
}

// ============================================================
// 目录扫描
// ============================================================

/**
 * 扫描单个目录中的匹配文件
 *
 * @param dir 目录绝对路径
 * @param options 扫描选项
 * @returns 扫描结果
 */
export async function scanDir(
  dir: string,
  options: ScanOptions,
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  try {
    const dirStat = await fs.stat(dir).catch(() => null);
    if (!dirStat?.isDirectory()) {
      return results;
    }

    const files = await scanDirForFiles(dir, options);

    for (const file of files) {
      const source = determineSource(dir);
      results.push({
        filePath: file,
        dirPath: dir,
        source,
      });
    }
  } catch (error) {
    console.debug(`[Scanner] Failed to scan ${dir}: ${(error as Error).message}`);
  }

  return results;
}

/**
 * 扫描多个目录
 *
 * @param dirs 目录列表
 * @param options 扫描选项
 * @returns 扫描结果（去重）
 */
export async function scanDirs(
  dirs: string[],
  options: ScanOptions,
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const seenPaths = new Set<string>();

  for (const dir of dirs) {
    const dirResults = await scanDir(dir, options);

    for (const result of dirResults) {
      const resolved = path.resolve(result.filePath);
      if (!seenPaths.has(resolved)) {
        seenPaths.add(resolved);
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * 扫描配置目录中的文件（支持 dirPattern）
 *
 * @param cwd 当前工作目录（用于解析相对路径）
 * @param config 扫描配置
 * @returns 扫描结果列表
 */
export async function scanConfigDirs(
  cwd: string,
  config: ScanConfig,
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const seenPaths = new Set<string>();

  for (const dir of config.dirs) {
    const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);

    try {
      const dirStat = await fs.stat(absoluteDir).catch(() => null);
      if (!dirStat?.isDirectory()) {
        continue;
      }

      const files = await scanDirForConfigFiles(absoluteDir, config);

      for (const file of files) {
        const resolved = path.resolve(file);
        if (seenPaths.has(resolved)) {
          continue;
        }
        seenPaths.add(resolved);

        const source = determineSource(absoluteDir);
        results.push({
          filePath: resolved,
          dirPath: absoluteDir,
          source,
        });
      }
    } catch (error) {
      console.debug(`[Scanner] Failed to scan ${absoluteDir}: ${(error as Error).message}`);
    }
  }

  return results;
}

// ============================================================
// 内部函数
// ============================================================

async function scanDirForFiles(dir: string, options: ScanOptions): Promise<string[]> {
  const files: string[] = [];

  if (options.recursive) {
    files.push(...await scanRecursive(dir, options.pattern));
  } else {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (matchesPattern(entry.name, options.pattern)) {
        files.push(path.join(dir, entry.name));
      }
    }
  }

  return files;
}

async function scanDirForConfigFiles(dir: string, config: ScanConfig): Promise<string[]> {
  const files: string[] = [];

  if (config.dirPattern) {
    // 目录格式：查找 dirPattern/SKILL.md 类型的文件
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.')) continue;

      // 检查目录名是否匹配
      if (config.dirPattern !== '*' && !matchesPattern(entry.name, config.dirPattern)) {
        continue;
      }

      const subDir = path.join(dir, entry.name);
      const targetFile = path.join(subDir, config.filePattern);

      try {
        const stat = await fs.stat(targetFile);
        if (stat.isFile()) {
          files.push(targetFile);
        }
      } catch {
        // 文件不存在，跳过
      }
    }
  } else if (config.recursive) {
    // 递归扫描
    files.push(...await scanRecursive(dir, config.filePattern));
  } else {
    // 直接匹配文件
    const targetFile = path.join(dir, config.filePattern);
    try {
      const stat = await fs.stat(targetFile);
      if (stat.isFile()) {
        files.push(targetFile);
      }
    } catch {
      // 文件不存在
    }

    // 也尝试扫描目录中的所有匹配文件
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (matchesPattern(entry.name, config.filePattern)) {
        files.push(path.join(dir, entry.name));
      }
    }
  }

  return files;
}

async function scanRecursive(dir: string, pattern: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(fullPath);
      } else if (entry.isFile() && matchesPattern(entry.name, pattern)) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true;

  // glob 模式
  if (pattern.includes('*')) {
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*');
    return new RegExp(`^${regex}$`).test(name);
  }

  return name === pattern;
}

function determineSource(dir: string): 'user' | 'project' {
  const userConfigDir = getUserConfigDir();

  if (dir.startsWith(userConfigDir)) {
    return 'user';
  }

  // 默认为 project
  return 'project';
}