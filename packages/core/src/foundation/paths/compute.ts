// ============================================================
// Paths - 路径计算函数
// ============================================================
//
// 重要变更（2026-04）：
// - DEFAULT_PROJECT_CONFIG_DIR_NAME 已迁移到 ResolvedLayout.configDirName
// - TOKENIZER_CACHE_DIR_NAME 已迁移到 ResolvedLayout.tokenizerCacheDir
//
// 设计模式：
// - compute*() 纯函数版本：接受 configDirName 参数，不依赖全局状态
// - get*() 便捷版本：使用全局单例 getResolvedConfigDirName()
//
// 调用方应从 runtime.layout 获取配置，或使用纯函数版本传入参数
// ============================================================

import path from 'path';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME, TOKENIZER_CACHE_DIR_NAME } from '../../config/defaults';
import { resolveHomeDir } from './resolve';

// ============================================================
// 全局单例：已解析的 configDirName
// ============================================================

/**
 * 已解析的配置目录名（全局单例）
 * 在 bootstrap() 时通过 resolveLayout() 设置一次
 * 之后所有 get* 便捷函数都使用此值
 */
let resolvedConfigDirName: string | null = null;

/**
 * 设置已解析的配置目录名
 * 通常只在 bootstrap() 的 resolveLayout() 中调用一次
 *
 * @param name 配置目录名（如 '.thething', '.siact'）
 */
export function setResolvedConfigDirName(name: string): void {
  resolvedConfigDirName = name;
}

/**
 * 获取已解析的配置目录名
 * 如果未设置，返回默认值 '.thething'
 *
 * @returns 配置目录名
 */
export function getResolvedConfigDirName(): string {
  return resolvedConfigDirName ?? DEFAULT_PROJECT_CONFIG_DIR_NAME;
}

/**
 * 清除已解析的配置目录名（用于测试或重新初始化）
 */
export function clearResolvedConfigDirName(): void {
  resolvedConfigDirName = null;
}

// ============================================================
// 配置目录路径（纯函数版本 - compute 前缀）
// ============================================================

/**
 * 计算用户全局配置目录（纯函数）
 *
 * @param homeDir 用户 home 目录
 * @param subdir 子目录名（如 'agents', 'skills', 'mcps'）
 * @param configDirName 配置目录名（默认 '.thething'）
 * @returns 目录绝对路径
 */
export function computeUserConfigDir(
  homeDir: string,
  subdir?: string,
  configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME
): string {
  if (subdir) {
    return path.join(homeDir, configDirName, subdir);
  }
  return path.join(homeDir, configDirName);
}

/**
 * 计算项目级配置目录（纯函数）
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @param configDirName 配置目录名（默认 '.thething'）
 * @returns 目录绝对路径
 */
export function computeProjectConfigDir(
  cwd: string,
  subdir?: string,
  configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME
): string {
  if (subdir) {
    return path.join(cwd, configDirName, subdir);
  }
  return path.join(cwd, configDirName);
}

/**
 * 计算所有配置目录（纯函数）
 *
 * @param homeDir 用户 home 目录
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @param configDirName 配置目录名（默认 '.thething'）
 * @returns [用户目录, 项目目录]
 */
export function computeConfigDirs(
  homeDir: string,
  cwd: string,
  subdir: string,
  configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME
): string[] {
  return [
    computeUserConfigDir(homeDir, subdir, configDirName),
    computeProjectConfigDir(cwd, subdir, configDirName),
  ];
}

// ============================================================
// 配置目录路径（便捷版本 - 使用全局单例）
// ============================================================
// 这些函数读取全局单例 getResolvedConfigDirName()

/**
 * 获取用户全局配置目录（便捷版本）
 *
 * @param subdir 子目录名（如 'agents', 'skills', 'mcps'）
 * @returns 目录绝对路径（使用全局单例 configDirName）
 */
export function getUserConfigDir(subdir?: string): string {
  return computeUserConfigDir(resolveHomeDir(), subdir, getResolvedConfigDirName());
}

/**
 * 获取项目级配置目录（便捷版本）
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @returns 目录绝对路径（使用全局单例 configDirName）
 */
export function getProjectConfigDir(cwd: string, subdir?: string): string {
  return computeProjectConfigDir(cwd, subdir, getResolvedConfigDirName());
}

/**
 * 获取所有配置目录（便捷版本）
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @returns [用户目录, 项目目录]（使用全局单例 configDirName）
 */
export function getConfigDirs(cwd: string, subdir: string): string[] {
  return computeConfigDirs(resolveHomeDir(), cwd, subdir, getResolvedConfigDirName());
}

// ============================================================
// 数据目录路径（纯函数版本）
// ============================================================

/**
 * 计算用户全局数据目录（纯函数）
 *
 * @param homeDir 用户 home 目录
 * @param configDirName 配置目录名（默认 '.thething'）
 * @returns 目录绝对路径
 */
export function computeUserDataDir(
  homeDir: string,
  configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME
): string {
  return path.join(homeDir, configDirName, 'data');
}

/**
 * 计算项目级数据目录（纯函数）
 *
 * @param cwd 项目根目录
 * @param configDirName 配置目录名（默认 '.thething'）
 * @returns 目录绝对路径
 */
export function computeProjectDataDir(
  cwd: string,
  configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME
): string {
  return path.join(cwd, configDirName, 'data');
}

// ============================================================
// 数据目录路径（便捷版本 - 使用全局单例）
// ============================================================

/**
 * 获取用户全局数据目录（便捷版本）
 *
 * @returns 目录绝对路径（使用全局单例 configDirName）
 */
export function getUserDataDir(): string {
  return computeUserDataDir(resolveHomeDir(), getResolvedConfigDirName());
}

/**
 * 获取项目级数据目录（便捷版本）
 *
 * @param cwd 项目根目录
 * @returns 目录绝对路径（使用全局单例 configDirName）
 */
export function getProjectDataDir(cwd: string): string {
  return computeProjectDataDir(cwd, getResolvedConfigDirName());
}

/**
 * 获取默认数据目录
 * 优先使用项目级，不存在则使用用户级
 */
export function getDefaultDataDir(): string {
  const cwd = process.cwd();
  return getProjectDataDir(cwd);
}

// ============================================================
// Tokenizer 缓存目录（纯函数版本）
// ============================================================

/**
 * 计算用户全局 Tokenizer 缓存目录（纯函数）
 *
 * 注意：Tokenizer 缓存目录不依赖 configDirName，
 * 它始终位于 ~/.cache/thething/tokenizers
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