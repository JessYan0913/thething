// ============================================================
// Permissions Loader
// ============================================================

import { PERMISSIONS_FILENAME } from '../../services/config/defaults';
import { loadRules } from '../../modules/permissions/loader';
import type { PermissionRule } from '../../modules/permissions/types';

// ============================================================
// 加载选项
// ============================================================

export interface LoadPermissionsOptions {
  cwd?: string;
  /** Permissions 配置文件名（来自 ResolvedLayout.filenames.permissions） */
  filename?: string;
  /** 显式扫描目录（来自 ResolvedLayout.resources.permissions） */
  dirs?: readonly string[];
  /** 配置目录路径（如 ~/.thething，用于计算默认目录） */
  configDir?: string;
  /** 用户 home 目录 */
  homeDir?: string;
}

// ============================================================
// 加载函数
// ============================================================

/**
 * 加载 Permissions 配置
 */
export async function loadPermissions(options?: LoadPermissionsOptions): Promise<PermissionRule[]> {
  const cwd = options?.cwd ?? process.cwd();
  const filename = options?.filename ?? PERMISSIONS_FILENAME;

  const config = await loadRules(cwd, filename, options?.dirs, {
    configDir: options?.configDir,
  });
  return config.rules;
}
