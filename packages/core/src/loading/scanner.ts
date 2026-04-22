import fs from 'fs/promises';
import path from 'path';

/**
 * 目录扫描配置
 */
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

/**
 * 扫描结果项
 */
export interface ScanResult {
  /** 文件绝对路径 */
  filePath: string;
  /** 文件所在目录 */
  dirPath: string;
  /** 来源标识（如 'user', 'project'） */
  source: string;
}

/**
 * 扫描配置目录中的文件
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

      const files = await scanDirForFiles(absoluteDir, config);

      for (const file of files) {
        const resolved = path.resolve(file);
        if (seenPaths.has(resolved)) {
          continue;
        }
        seenPaths.add(resolved);

        const source = determineSource(absoluteDir, cwd);
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

/**
 * 扫描目录中的匹配文件
 */
async function scanDirForFiles(dir: string, config: ScanConfig): Promise<string[]> {
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

/**
 * 递归扫描目录
 */
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

/**
 * 简单的模式匹配（支持 * 通配符）
 */
function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === '*.md') return name.endsWith('.md');
  if (pattern === 'SKILL.md') return name === 'SKILL.md';

  // 处理 glob 模式
  if (pattern.includes('*')) {
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*');
    return new RegExp(`^${regex}$`).test(name);
  }

  return name === pattern;
}

/**
 * 根据目录路径确定来源
 */
function determineSource(dir: string, cwd: string): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const userConfigDir = path.join(homeDir, '.thething');

  if (dir.startsWith(userConfigDir)) {
    return 'user';
  }

  if (dir.startsWith(cwd)) {
    return 'project';
  }

  return 'unknown';
}

/**
 * 按优先级合并配置项
 *
 * @param items 配置项列表
 * @param priorityOrder 优先级顺序（如 ['project', 'user', 'builtin']）
 * @param getKey 获取唯一标识的函数
 * @returns 合并后的列表
 */
export function mergeByPriority<T>(
  items: T[],
  priorityOrder: string[],
  getKey: (item: T) => string,
): T[] {
  const merged = new Map<string, T>();

  // 按优先级顺序处理（低优先级先处理，高优先级覆盖）
  for (const source of priorityOrder.reverse()) {
    for (const item of items) {
      const key = getKey(item);
      const itemSource = (item as { source?: string }).source;

      if (itemSource === source) {
        merged.set(key, item);
      }
    }
  }

  return Array.from(merged.values());
}