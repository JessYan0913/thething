// ============================================================
// Paths - 路径计算函数（纯函数版本）
// ============================================================
//
// 重要变更（2026-04）：
// - DEFAULT_PROJECT_CONFIG_DIR_NAME 已迁移到 ResolvedLayout.configDirName
// - TOKENIZER_CACHE_DIR_NAME 已移除（tokenizer 已替换为字符估算）
// - 全局单例（resolvedConfigDirName, resolvedCwd）已移除
//
// 设计模式：
// - compute*() 纯函数版本：接受 configDirName 参数，不依赖全局状态
//
// 调用方应从 runtime.layout 获取配置，或使用纯函数版本传入参数
// ============================================================

import path from 'path';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../constants';
import { resolveHomeDir } from './resolve';

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

/**
 * 获取默认数据目录
 * 优先使用项目级，不存在则使用用户级
 */
export function getDefaultDataDir(): string {
  const cwd = process.cwd();
  return computeProjectDataDir(cwd);
}