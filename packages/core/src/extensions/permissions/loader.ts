/**
 * 权限配置加载器
 *
 * 配置文件路径:
 * - 用户全局: ~/${configDirName}/permissions/permissions.json
 * - 项目级: 项目/${configDirName}/permissions/permissions.json
 *
 * 优先级: 项目级 > 用户全局
 *
 * 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
 * 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。
 *
 * 重要变更（2026-04）：
 * - PERMISSIONS_FILENAME 已迁移到 ResolvedLayout.filenames.permissions
 * - 调用方可通过 filename 参数传入配置
 * - 未传入时使用 defaults.ts 作为 fallback
 */

import path from 'path';
import { parseJsonFile } from '../../foundation/parser';
import { LoadingCache } from '../../foundation/scanner';
import { computeUserConfigDir, computeProjectConfigDir, resolveHomeDir } from '../../foundation/paths';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME, PERMISSIONS_FILENAME } from '../../config/defaults';
import type { PermissionConfig, PermissionRule } from './types';
import { PermissionConfigSchema } from './types';

const CURRENT_VERSION = 1;

// 使用 LoadingCache 替代独立的缓存变量
const permissionsCache = new LoadingCache<PermissionConfig>();

/**
 * 获取配置文件的绝对路径
 *
 * @param dir 目录路径
 * @param filename 文件名（默认 PERMISSIONS_FILENAME）
 */
function getPermissionsFilePath(dir: string, filename: string = PERMISSIONS_FILENAME): string {
  return path.join(dir, filename);
}

function getPermissionDirs(
  cwd: string,
  dirs?: readonly string[],
  options?: {
    configDirName?: string;
    homeDir?: string;
  },
): string[] {
  if (dirs) {
    return [...dirs];
  }

  const configDirName = options?.configDirName ?? DEFAULT_PROJECT_CONFIG_DIR_NAME;
  const homeDir = options?.homeDir ?? resolveHomeDir();
  return [
    computeUserConfigDir(homeDir, 'permissions', configDirName),
    computeProjectConfigDir(cwd, 'permissions', configDirName),
  ];
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
 * @param filename 配置文件名（来自 ResolvedLayout.filenames.permissions）
 *
 * 加载顺序：
 * 1. 用户全局配置 (~/${configDirName}/permissions/permissions.json)
 * 2. 项目级配置 (项目/${configDirName}/permissions/permissions.json)
 *
 * 合并规则：项目级优先级高于用户级
 *
 * 注意：configDirName 从全局单例 getResolvedConfigDirName() 获取
 */
export async function loadRules(
  cwd?: string,
  filename?: string,
  dirs?: readonly string[],
  options?: {
    configDirName?: string;
    homeDir?: string;
  },
): Promise<PermissionConfig> {
  const effectiveCwd = cwd ?? process.cwd();
  const effectiveFilename = filename ?? PERMISSIONS_FILENAME;
  const effectiveDirs = getPermissionDirs(effectiveCwd, dirs, options);
  const cacheKey = `permissions:${effectiveCwd}:${effectiveFilename}:${effectiveDirs.join('|')}`;

  // 检查缓存
  const cached = permissionsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const loadedRules: PermissionRule[][] = [];
  for (const [index, dir] of effectiveDirs.entries()) {
    const filePath = getPermissionsFilePath(dir, effectiveFilename);
    const config = await loadConfigFile(filePath);
    const source: PermissionRule['source'] = index === effectiveDirs.length - 1 ? 'project' : 'user';
    const rules = config?.rules ?? [];
    for (const rule of rules) {
      rule.source = source;
      rule.filePath = filePath;
    }
    loadedRules.push(rules);
  }

  // 合并规则：项目级覆盖同 id 的用户级规则
  const mergedRules = loadedRules.reduce<PermissionRule[]>((acc, rules) => mergeRules(acc, rules), []);

  const mergedConfig: PermissionConfig = {
    rules: mergedRules,
    version: CURRENT_VERSION,
  };

  // 更新缓存
  permissionsCache.set(cacheKey, mergedConfig);
  // 同步 needsApproval 使用的旧 key；AppContext 是当前对话的配置快照。
  permissionsCache.set(`permissions:${effectiveCwd}:${effectiveFilename}`, mergedConfig);

  return mergedConfig;
}

/**
 * 同步加载（用于 needsApproval 中，避免异步问题）
 * 需要先调用 loadRules() 进行初始化
 *
 * 使用全局单例 getResolvedCwd() 获取 cwd，
 * 该值在 bootstrap() 时通过 setResolvedCwd() 设置。
 *
 * @param cwd 当前工作目录（可选，默认使用全局单例）
 * @param filename 配置文件名（可选，默认 PERMISSIONS_FILENAME）
 */
export function loadRulesSync(cwd?: string, filename?: string): PermissionConfig {
  const effectiveCwd = cwd ?? process.cwd();
  const effectiveFilename = filename ?? PERMISSIONS_FILENAME;
  const cacheKey = `permissions:${effectiveCwd}:${effectiveFilename}`;

  const cached = permissionsCache.get(cacheKey);
  if (cached) {
    console.log(`[loadRulesSync] ✅ Found cached rules: ${cached.rules.length} rules for ${effectiveCwd}`);
    return cached;
  }

  // 缓存未找到，返回空配置
  console.log(`[loadRulesSync] ⚠️ Cache not found for key: ${cacheKey}`);
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
 * @param filename 配置文件名（来自 ResolvedLayout.filenames.permissions）
 */
export async function initPermissions(cwd?: string, filename?: string): Promise<void> {
  await loadRules(cwd, filename);
}

// ============================================================
// 导出内部函数供 rules.ts 使用
// ============================================================

export { createEmptyConfig, getPermissionsFilePath };
