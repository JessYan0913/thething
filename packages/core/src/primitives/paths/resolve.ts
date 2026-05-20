// ============================================================
// Paths Resolve - 环境感知路径解析
// ============================================================
// 此模块允许读取进程状态（process.cwd()、os.homedir()）
// 用于解析实际路径，但 monorepo 感知逻辑通过参数注入

import path from 'path';
import os from 'os';

/**
 * 检测项目根目录
 *
 * 此函数允许读取 process.cwd()，因为它的职责就是解析当前环境。
 * monorepo 感知逻辑通过可配置的 patterns 参数注入，
 * 而不是硬编码。
 *
 * @param options 解析选项
 * @param options.cwd 自定义 cwd（默认使用 process.cwd()）
 * @param options.monorepoPatterns 触发向上查找的路径片段
 * @returns 项目根目录路径
 */
export function resolveProjectDir(options?: {
  cwd?: string;
  /**
   * 触发向上查找的路径片段。
   * 当 cwd 包含这些片段之一时，向上查找直到不包含为止。
   * 默认值由应用层（CLI/Server）注入，core 包不硬编码。
   */
  monorepoPatterns?: string[];
}): string {
  const cwd = options?.cwd ?? process.cwd();
  const patterns = options?.monorepoPatterns ?? [];

  if (patterns.length === 0) return cwd;

  const matches = patterns.some(p => cwd.includes(p));
  if (!matches) return cwd;

  let dir = cwd;
  while (patterns.some(p => dir.includes(p))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

/**
 * 获取系统 home 目录（允许环境感知）
 *
 * @returns 用户 home 目录路径
 */
export function resolveHomeDir(): string {
  return os.homedir();
}