// ============================================================
// Paths - 路径计算函数
// ============================================================

import path from 'path';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME, TOKENIZER_CACHE_DIR_NAME } from '../../config/defaults';
import { resolveProjectDir, resolveHomeDir } from './resolve';

// ============================================================
// 项目目录检测
// ============================================================

/**
 * 检测项目根目录
 *
 * @deprecated 使用 resolveProjectDir({ monorepoPatterns: [...] }) 替代。
 * 此函数保留向后兼容，默认使用 core 包内部的 monorepo patterns。
 *
 * 在 monorepo 开发模式下（从 packages/server 或 packages/cli 运行），
 * 返回 monorepo 根目录，而不是 packages 目录。
 */
export function detectProjectDir(): string {
  return resolveProjectDir({
    monorepoPatterns: ['packages/server', 'packages/cli'],
  });
}

// ============================================================
// 配置目录路径（纯函数版本 - compute 前缀）
// ============================================================

/**
 * 计算用户全局配置目录（纯函数）
 *
 * @param homeDir 用户 home 目录
 * @param subdir 子目录名（如 'agents', 'skills', 'mcps'）
 * @returns 目录绝对路径
 */
export function computeUserConfigDir(homeDir: string, subdir?: string): string {
  if (subdir) {
    return path.join(homeDir, DEFAULT_PROJECT_CONFIG_DIR_NAME, subdir);
  }
  return path.join(homeDir, DEFAULT_PROJECT_CONFIG_DIR_NAME);
}

/**
 * 计算项目级配置目录（纯函数）
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @returns 目录绝对路径
 */
export function computeProjectConfigDir(cwd: string, subdir?: string): string {
  if (subdir) {
    return path.join(cwd, DEFAULT_PROJECT_CONFIG_DIR_NAME, subdir);
  }
  return path.join(cwd, DEFAULT_PROJECT_CONFIG_DIR_NAME);
}

/**
 * 计算所有配置目录（纯函数）
 *
 * @param homeDir 用户 home 目录
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @returns [用户目录, 项目目录]
 */
export function computeConfigDirs(homeDir: string, cwd: string, subdir: string): string[] {
  return [
    computeUserConfigDir(homeDir, subdir),
    computeProjectConfigDir(cwd, subdir),
  ];
}

// ============================================================
// 配置目录路径（便捷版本 - 向后兼容）
// ============================================================
// 这些函数读取当前环境，保持原有签名

/**
 * 获取用户全局配置目录（便捷版本）
 *
 * @param subdir 子目录名（如 'agents', 'skills', 'mcps'）
 * @returns 目录绝对路径
 */
export function getUserConfigDir(subdir?: string): string {
  return computeUserConfigDir(resolveHomeDir(), subdir);
}

/**
 * 获取项目级配置目录（便捷版本）
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @returns 目录绝对路径
 */
export function getProjectConfigDir(cwd: string, subdir?: string): string {
  return computeProjectConfigDir(cwd, subdir);
}

/**
 * 获取所有配置目录（便捷版本）
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @returns [用户目录, 项目目录]
 */
export function getConfigDirs(cwd: string, subdir: string): string[] {
  return computeConfigDirs(resolveHomeDir(), cwd, subdir);
}

// ============================================================
// 数据目录路径（纯函数版本）
// ============================================================

/**
 * 计算用户全局数据目录（纯函数）
 *
 * @param homeDir 用户 home 目录
 * @returns 目录绝对路径
 */
export function computeUserDataDir(homeDir: string): string {
  return path.join(homeDir, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'data');
}

/**
 * 计算项目级数据目录（纯函数）
 *
 * @param cwd 项目根目录
 * @returns 目录绝对路径
 */
export function computeProjectDataDir(cwd: string): string {
  return path.join(cwd, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'data');
}

// ============================================================
// 数据目录路径（便捷版本 - 向后兼容）
// ============================================================

/**
 * 获取用户全局数据目录（便捷版本）
 *
 * @returns 目录绝对路径
 */
export function getUserDataDir(): string {
  return computeUserDataDir(resolveHomeDir());
}

/**
 * 获取项目级数据目录（便捷版本）
 *
 * @param cwd 项目根目录
 * @returns 目录绝对路径
 */
export function getProjectDataDir(cwd: string): string {
  return computeProjectDataDir(cwd);
}

/**
 * 获取默认数据目录
 * 优先使用项目级，不存在则使用用户级
 */
export function getDefaultDataDir(): string {
  const cwd = detectProjectDir();
  return getProjectDataDir(cwd);
}

// ============================================================
// Tokenizer 缓存目录（纯函数版本）
// ============================================================

/**
 * 计算用户全局 Tokenizer 缓存目录（纯函数）
 *
 * @param homeDir 用户 home 目录
 * @param subdir 子目录名（如版本号或 repo 名）
 * @returns 目录绝对路径
 */
export function computeUserTokenizerCacheDir(homeDir: string, subdir?: string): string {
  const cacheBase = path.join(homeDir, '.cache', 'thething', TOKENIZER_CACHE_DIR_NAME);
  if (subdir) {
    return path.join(cacheBase, subdir);
  }
  return cacheBase;
}

// ============================================================
// Tokenizer 缓存目录（便捷版本 - 向后兼容）
// ============================================================

/**
 * 获取用户全局 Tokenizer 缓存目录（便捷版本）
 *
 * @param subdir 子目录名（如版本号或 repo 名）
 * @returns 目录绝对路径
 */
export function getUserTokenizerCacheDir(subdir?: string): string {
  return computeUserTokenizerCacheDir(resolveHomeDir(), subdir);
}