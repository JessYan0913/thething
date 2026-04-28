/**
 * 权限配置加载器
 *
 * 配置文件路径:
 * - 用户全局: ~/${DEFAULT_PROJECT_CONFIG_DIR_NAME}/permissions/permissions.json
 * - 项目级: 项目/${DEFAULT_PROJECT_CONFIG_DIR_NAME}/permissions/permissions.json
 *
 * 优先级: 项目级 > 用户全局
 */

import path from 'path';
import { parseJsonFile } from '../../foundation/parser';
import { LoadingCache } from '../../foundation/scanner';
import { detectProjectDir, getUserConfigDir, getProjectConfigDir } from '../../foundation/paths';
import { PERMISSIONS_FILENAME, DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../config/defaults';
import type { PermissionConfig, PermissionRule } from './types';
import { PermissionConfigSchema } from './types';

const CURRENT_VERSION = 1;

// 使用 LoadingCache 替代独立的缓存变量
const permissionsCache = new LoadingCache<PermissionConfig>();

/**
 * 获取配置文件的绝对路径
 */
function getPermissionsFilePath(dir: string): string {
  return path.join(dir, PERMISSIONS_FILENAME);
}

/**
 * 创建空配置
 */
function createEmptyConfig(): PermissionConfig {
  return {
    rules: [],
    version: CURRENT_VERSION,
  };
}

/**
 * 加载单个配置文件
 */
async function loadConfigFile(filePath: string): Promise<PermissionConfig | null> {
  try {
    const result = await parseJsonFile(filePath, PermissionConfigSchema);
    return result.data;
  } catch {
    // 文件不存在或解析失败
    return null;
  }
}

/**
 * 合并规则（项目级优先）
 */
function mergeRules(userRules: PermissionRule[], projectRules: PermissionRule[]): PermissionRule[] {
  const ruleMap = new Map<string, PermissionRule>();

  // 先添加用户级规则
  for (const rule of userRules) {
    ruleMap.set(rule.id, rule);
  }

  // 项目级规则覆盖同 id 的用户级规则
  for (const rule of projectRules) {
    ruleMap.set(rule.id, rule);
  }

  // 按来源排序：project 优先
  return Array.from(ruleMap.values()).sort((a, b) => {
    if (a.source === 'project' && b.source !== 'project') return -1;
    if (a.source !== 'project' && b.source === 'project') return 1;
    return a.createdAt - b.createdAt;
  });
}

/**
 * 加载权限配置（支持多层级）
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 *
 * 加载顺序：
 * 1. 用户全局配置 (~/${DEFAULT_PROJECT_CONFIG_DIR_NAME}/permissions/permissions.json)
 * 2. 项目级配置 (项目/${DEFAULT_PROJECT_CONFIG_DIR_NAME}/permissions/permissions.json)
 *
 * 合并规则：项目级优先级高于用户级
 */
export async function loadRules(cwd?: string): Promise<PermissionConfig> {
  const effectiveCwd = cwd ?? detectProjectDir();
  const cacheKey = `permissions:${effectiveCwd}`;

  // 检查缓存
  const cached = permissionsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const userDir = getUserConfigDir('permissions');
  const projectDir = getProjectConfigDir(effectiveCwd, 'permissions');

  // 加载用户级配置
  const userConfig = await loadConfigFile(getPermissionsFilePath(userDir));
  const userRules = userConfig?.rules ?? [];

  // 标记用户级规则的来源
  for (const rule of userRules) {
    rule.source = 'user';
  }

  // 加载项目级配置
  const projectConfig = await loadConfigFile(getPermissionsFilePath(projectDir));
  const projectRules = projectConfig?.rules ?? [];

  // 标记项目级规则的来源
  for (const rule of projectRules) {
    rule.source = 'project';
  }

  // 合并规则：项目级覆盖同 id 的用户级规则
  const mergedRules = mergeRules(userRules, projectRules);

  const mergedConfig: PermissionConfig = {
    rules: mergedRules,
    version: CURRENT_VERSION,
  };

  // 更新缓存
  permissionsCache.set(cacheKey, mergedConfig);

  return mergedConfig;
}

/**
 * 同步加载（用于 needsApproval 中，避免异步问题）
 * 需要先调用 loadRules() 进行初始化
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 */
export function loadRulesSync(cwd?: string): PermissionConfig {
  const effectiveCwd = cwd ?? detectProjectDir();
  const cacheKey = `permissions:${effectiveCwd}`;

  const cached = permissionsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 返回空配置，避免在 needsApproval 中出错
  return createEmptyConfig();
}

/**
 * 清除缓存
 */
export function clearPermissionsCache(): void {
  permissionsCache.clear();
}

/**
 * 初始化：加载规则到内存缓存
 * 应在应用启动时调用
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 */
export async function initPermissions(cwd?: string): Promise<void> {
  await loadRules(cwd);
}

// ============================================================
// 导出内部函数供 rules.ts 使用
// ============================================================

export { createEmptyConfig, getPermissionsFilePath };