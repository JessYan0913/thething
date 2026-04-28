// ============================================================
// Paths - 路径计算函数
// ============================================================

import path from 'path';
import os from 'os';
import { PROJECT_CONFIG_DIR_NAME, TOKENIZER_CACHE_DIR_NAME } from '../../config/defaults';

// ============================================================
// 项目目录检测
// ============================================================

/**
 * 检测项目根目录
 *
 * 在 monorepo 开发模式下（从 packages/server 或 packages/cli 运行），
 * 返回 monorepo 根目录，而不是 packages 目录
 *
 * 这样可以确保配置文件在正确的位置：
 * - 项目级配置: 项目根/${PROJECT_CONFIG_DIR_NAME}/
 * - 用户级配置: ~/${PROJECT_CONFIG_DIR_NAME}/
 */
export function detectProjectDir(): string {
  const cwd = process.cwd();

  // Monorepo 开发模式检测
  if (cwd.includes('packages/server') || cwd.includes('packages/cli')) {
    // 向上找到不包含 packages 的目录
    let dir = cwd;
    while (dir.includes('packages')) {
      dir = path.dirname(dir);
    }
    return dir;
  }

  return cwd;
}

// ============================================================
// 配置目录路径
// ============================================================

/**
 * 获取用户全局配置目录
 *
 * @param subdir 子目录名（如 'agents', 'skills', 'mcps'）
 * @returns 目录绝对路径
 */
export function getUserConfigDir(subdir?: string): string {
  const homeDir = os.homedir();
  if (subdir) {
    return path.join(homeDir, PROJECT_CONFIG_DIR_NAME, subdir);
  }
  return path.join(homeDir, PROJECT_CONFIG_DIR_NAME);
}

/**
 * 获取项目级配置目录
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @returns 目录绝对路径
 */
export function getProjectConfigDir(cwd: string, subdir?: string): string {
  if (subdir) {
    return path.join(cwd, PROJECT_CONFIG_DIR_NAME, subdir);
  }
  return path.join(cwd, PROJECT_CONFIG_DIR_NAME);
}

/**
 * 获取所有配置目录
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @returns [用户目录, 项目目录]
 */
export function getConfigDirs(cwd: string, subdir: string): string[] {
  return [
    getUserConfigDir(subdir),
    getProjectConfigDir(cwd, subdir),
  ];
}

// ============================================================
// 数据目录路径
// ============================================================

/**
 * 获取用户全局数据目录
 *
 * @returns 目录绝对路径
 */
export function getUserDataDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, PROJECT_CONFIG_DIR_NAME, 'data');
}

/**
 * 获取项目级数据目录
 *
 * @param cwd 项目根目录
 * @returns 目录绝对路径
 */
export function getProjectDataDir(cwd: string): string {
  return path.join(cwd, PROJECT_CONFIG_DIR_NAME, 'data');
}

// ============================================================
// 配置文件路径
// ============================================================

/**
 * 获取默认数据目录
 * 优先使用项目级，不存在则使用用户级
 */
export function getDefaultDataDir(): string {
  const cwd = detectProjectDir();
  const projectDataDir = getProjectDataDir(cwd);

  // 如果项目数据目录存在，使用项目级
  // 否则使用用户级
  return projectDataDir;
}

// ============================================================
// Tokenizer 缓存目录
// ============================================================

/**
 * 获取用户全局 Tokenizer 缓存目录
 *
 * @param subdir 子目录名（如版本号或 repo 名）
 * @returns 目录绝对路径
 */
export function getUserTokenizerCacheDir(subdir?: string): string {
  const homeDir = os.homedir();
  const cacheBase = path.join(homeDir, '.cache', 'thething', TOKENIZER_CACHE_DIR_NAME);
  if (subdir) {
    return path.join(cacheBase, subdir);
  }
  return cacheBase;
}