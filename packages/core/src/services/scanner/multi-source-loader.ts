// ============================================================
// Multi-Source Config Loader - 通用多源配置加载器
// ============================================================
// 统一 skills/mcp/connector/agents 的 "扫描用户目录 → 扫描项目目录 → 合并" 模式。
//
// 使用方式：
// ```typescript
// const loadMyConfig = createMultiSourceLoader<MyConfig>({
//   subcategory: 'my-config',
//   filePattern: '*.json',
//   parse: (filePath) => parseJsonFile(filePath, MySchema),
//   getMergeKey: (item) => item.name,
// });
// const configs = await loadMyConfig({ cwd, configDirName, homeDir });
// ```

import { computeUserConfigDir, computeProjectConfigDir } from '../../primitives/paths/compute';
import { scanDirs, scanConfigDirs, type ScanResult } from './scan';
import { mergeByPriority } from './merge';
import { logger } from '../../primitives/logger';
import type { ConfigSource } from '../../primitives/constants';

export interface MultiSourceLoaderOptions<T extends { source: string }> {
  /** 子目录名（如 'skills', 'mcps', 'agents'） */
  subcategory: string;
  /** 文件匹配模式（如 '*.json', '*.md', '*.yaml'） */
  filePattern: string;
  /** 多扩展名匹配（如 ['*.yaml', '*.yml']），与 filePattern 二选一 */
  filePatterns?: string[];
  /** 扫描模式：flat（默认，直接扫描文件）或 configDir（子目录结构如 {name}/SKILL.md） */
  scanMode?: 'flat' | 'configDir';
  /** configDir 模式下的目录匹配模式（默认 '*'） */
  dirPattern?: string;
  /** 文件解析函数 */
  parse: (filePath: string, source: ConfigSource) => Promise<T | null>;
  /** 合并去重的 key 提取函数 */
  getMergeKey: (item: T) => string;
  /** 合并优先级（默认 project 覆盖 user） */
  priorityOrder?: Array<ConfigSource>;
}

export interface MultiSourceLoaderLoadOptions {
  cwd?: string;
  configDirName?: string;
  homeDir?: string;
  /** 显式指定目录（跳过自动计算） */
  dirs?: readonly string[];
}

export function createMultiSourceLoader<T extends { source: string }>(
  loaderOptions: MultiSourceLoaderOptions<T>,
) {
  const {
    subcategory,
    filePattern,
    filePatterns,
    scanMode = 'flat',
    dirPattern = '*',
    parse,
    getMergeKey,
    priorityOrder = ['project', 'user'],
  } = loaderOptions;

  async function load(options?: MultiSourceLoaderLoadOptions): Promise<T[]> {
    const cwd = options?.cwd ?? process.cwd();
    const configDirName = options?.configDirName ?? '.thething';
    const homeDir = options?.homeDir ?? (await import('os')).homedir();

    // 解析目录
    let dirs: string[];
    let sourceByDir: Map<string, ConfigSource>;

    if (options?.dirs && options.dirs.length > 0) {
      dirs = [...options.dirs];
      const userBase = computeUserConfigDir(homeDir, subcategory, configDirName);
      sourceByDir = new Map(
        dirs.map(d => [d, d.startsWith(userBase) ? 'user' : 'project'])
      );
    } else {
      const userDir = computeUserConfigDir(homeDir, subcategory, configDirName);
      const projectDir = computeProjectConfigDir(cwd, subcategory, configDirName);
      dirs = [userDir, projectDir];
      sourceByDir = new Map([
        [userDir, 'user'],
        [projectDir, 'project'],
      ]);
    }

    // 扫描文件
    let scanResults: ScanResult[];
    if (scanMode === 'configDir') {
      scanResults = await scanConfigDirs(cwd, {
        dirs,
        filePattern,
        dirPattern,
        recursive: false,
      }, sourceByDir);
    } else if (filePatterns && filePatterns.length > 0) {
      scanResults = [];
      for (const pattern of filePatterns) {
        const results = await scanDirs(dirs, { pattern }, sourceByDir);
        scanResults.push(...results);
      }
    } else {
      scanResults = await scanDirs(dirs, { pattern: filePattern }, sourceByDir);
    }

    // 解析文件
    const items: T[] = [];
    for (const result of scanResults) {
      try {
        const item = await parse(result.filePath, result.source as ConfigSource);
        if (item) {
          items.push(item);
        }
      } catch (error) {
        logger.warn(subcategory, `Failed to load ${result.filePath}: ${(error as Error).message}`);
      }
    }

    // 合并
    return mergeByPriority(items, priorityOrder, getMergeKey);
  }

  return { load };
}
