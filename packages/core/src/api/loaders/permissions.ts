// ============================================================
// Permissions Loader - 使用 extensions/permissions/loader.ts 的统一缓存
// ============================================================
//
// 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
// 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。
//
// 重要变更（2026-04）：
// - PERMISSIONS_FILENAME 已迁移到 ResolvedLayout.filenames.permissions
// - 调用方可通过 options.filename 传入自定义文件名
// - 未传入时使用 defaults.ts 作为 fallback

import { PERMISSIONS_FILENAME } from '../../config/defaults';
import { loadRules, clearPermissionsCache } from '../../extensions/permissions/loader';
import type { PermissionRule } from '../../extensions/permissions/types';

// ============================================================
// 加载选项
// ============================================================

export interface LoadPermissionsOptions {
  cwd?: string;
  /** Permissions 配置文件名（来自 ResolvedLayout.filenames.permissions） */
  filename?: string;
}

// ============================================================
// 加载函数
// ============================================================

/**
 * 加载 Permissions 配置
 *
 * 使用 extensions/permissions/loader.ts 的统一缓存，
 * 确保 needsApproval 中的 loadRulesSync 能访问到相同的缓存。
 *
 * @param options 加载选项（filename 可从 ResolvedLayout.filenames.permissions 传入）
 * @returns PermissionRule 列表
 */
export async function loadPermissions(options?: LoadPermissionsOptions): Promise<PermissionRule[]> {
  const cwd = options?.cwd ?? process.cwd();
  const filename = options?.filename ?? PERMISSIONS_FILENAME;

  // 使用统一的 loader，共享缓存
  const config = await loadRules(cwd, filename);
  return config.rules;
}

/**
 * 清除缓存
 */
export { clearPermissionsCache };