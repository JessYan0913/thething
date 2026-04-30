// ============================================================
// Permissions Loader
// ============================================================
//
// 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
// 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。
//
// 重要变更（2026-04）：
// - PERMISSIONS_FILENAME 已迁移到 ResolvedLayout.filenames.permissions
// - 调用方可通过 options.filename 传入自定义文件名
// - 未传入时使用 defaults.ts 作为 fallback

import { parseJsonFile } from '../../foundation/parser';
import { LoadingCache } from '../../foundation/scanner';
import { getUserConfigDir, getProjectConfigDir } from '../../foundation/paths';
import { PERMISSIONS_FILENAME } from '../../config/defaults';
import type { PermissionConfig, PermissionRule } from '../../extensions/permissions/types';
import { PermissionConfigSchema } from '../../extensions/permissions/types';

// ============================================================
// 扩展类型
// ============================================================

interface RuleWithSource extends PermissionRule {
  source: 'user' | 'project';
}

// ============================================================
// 缓存
// ============================================================

const permissionsCache = new LoadingCache<PermissionConfig>();

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
 * 注意：configDirName 从全局单例 getResolvedConfigDirName() 获取
 *
 * @param options 加载选项（filename 可从 ResolvedLayout.filenames.permissions 传入）
 * @returns PermissionRule 列表
 */
export async function loadPermissions(options?: LoadPermissionsOptions): Promise<PermissionRule[]> {
  const cwd = options?.cwd ?? process.cwd();
  // 使用传入的 filename，否则使用 fallback
  const filename = options?.filename ?? PERMISSIONS_FILENAME;

  // 检查缓存
  const cacheKey = `permissions:${cwd}:${filename}`;
  const cached = permissionsCache.get(cacheKey);
  if (cached) {
    return cached.rules;
  }

  // 使用全局 configDirName
  const userDir = getUserConfigDir('permissions');
  const projectDir = getProjectConfigDir(cwd, 'permissions');

  // 加载用户级配置
  const userRules = await loadPermissionsFile(userDir, 'user', filename);

  // 加载项目级配置
  const projectRules = await loadPermissionsFile(projectDir, 'project', filename);

  // 合并（project > user）
  const allRules: RuleWithSource[] = [...userRules, ...projectRules];
  const ruleMap = new Map<string, PermissionRule>();

  // 先添加用户级
  for (const rule of userRules) {
    ruleMap.set(rule.id, rule);
  }

  // 项目级覆盖
  for (const rule of projectRules) {
    ruleMap.set(rule.id, rule);
  }

  // 排序：project 优先
  const result = Array.from(ruleMap.values()).sort((a, b) => {
    if (a.source === 'project' && b.source !== 'project') return -1;
    if (a.source !== 'project' && b.source === 'project') return 1;
    return a.createdAt - b.createdAt;
  });

  // 更新缓存
  permissionsCache.set(cacheKey, { rules: result, version: 1 });

  return result;
}

/**
 * 加载单个 permissions.json 文件
 *
 * @param dir 目录路径
 * @param source 来源
 * @param filename 文件名（默认 'permissions.json'）
 * @returns PermissionRule 列表（带 source）
 */
async function loadPermissionsFile(
  dir: string,
  source: 'user' | 'project',
  filename: string = PERMISSIONS_FILENAME,
): Promise<RuleWithSource[]> {
  const filePath = `${dir}/${filename}`;

  try {
    const result = await parseJsonFile(filePath, PermissionConfigSchema);
    return result.data.rules.map((rule) => ({
      ...rule,
      source,
    }));
  } catch {
    // 文件不存在或解析失败
    return [];
  }
}

/**
 * 清除缓存
 */
export function clearPermissionsCache(): void {
  permissionsCache.clear();
}