// ============================================================
// Paths - 路径计算函数（纯函数版本）
// ============================================================
//
// configDir 参数为完整路径（如 ~/.thething），由应用层注入。
// core 不再拼接 home 目录，也不提供默认值。
// ============================================================

import path from 'path';

// ============================================================
// 配置目录路径（纯函数版本 - compute 前缀）
// ============================================================

/**
 * 从用户配置目录展开子目录（纯函数）
 *
 * @param configDir 用户配置目录（绝对路径，如 ~/.thething）
 * @param subdir 子目录名（如 'agents', 'skills', 'mcps'）
 * @returns 子目录绝对路径
 */
export function computeUserConfigDir(
  configDir: string,
  subdir?: string,
): string {
  if (subdir) {
    return path.join(configDir, subdir);
  }
  return configDir;
}

/**
 * 计算项目级配置目录（纯函数）
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @param configDir 用户配置目录（绝对路径，从中提取目录名拼接项目路径）
 * @returns 目录绝对路径
 */
export function computeProjectConfigDir(
  cwd: string,
  subdir: string,
  configDir: string
): string {
  const name = path.basename(configDir);
  return path.join(cwd, name, subdir);
}

/**
 * 计算所有配置目录（纯函数）
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @param configDir 用户配置目录（绝对路径）
 * @returns [用户目录, 项目目录]
 */
export function computeConfigDirs(
  cwd: string,
  subdir: string,
  configDir: string
): string[] {
  return [
    computeUserConfigDir(configDir, subdir),
    computeProjectConfigDir(cwd, subdir, configDir),
  ];
}

// ============================================================
// 数据目录路径（纯函数版本）
// ============================================================

/**
 * 计算用户全局数据目录（纯函数）
 *
 * @param configDir 用户配置目录（绝对路径）
 * @returns 数据目录绝对路径
 */
export function computeUserDataDir(
  configDir: string
): string {
  return path.join(configDir, 'data');
}

/**
 * 计算项目级数据目录（纯函数）
 *
 * @param cwd 项目根目录
 * @param configDir 用户配置目录（绝对路径，从中提取目录名拼接项目路径）
 * @returns 目录绝对路径
 */
export function computeProjectDataDir(
  cwd: string,
  configDir: string
): string {
  return path.join(cwd, path.basename(configDir), 'data');
}

/**
 * 获取默认数据目录
 * 优先使用项目级，不存在则使用用户级
 *
 * @param configDir 用户配置目录（绝对路径）
 */
export function getDefaultDataDir(configDir: string): string {
  const cwd = process.cwd();
  return computeProjectDataDir(cwd, configDir);
}