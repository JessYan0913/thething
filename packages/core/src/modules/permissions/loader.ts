/**
 * 权限配置加载器
 *
 * 配置文件路径:
 * - 用户全局: ~/${configDirName}/permissions/permissions.json
 * - 项目级: 项目/${configDirName}/permissions/permissions.json
 *
 * 优先级: 项目级 > 用户全局
 */

import path from 'path';
import { parseJsonFile } from '../../primitives/parser';
import { computeUserConfigDir, computeProjectConfigDir, resolveHomeDir } from '../../primitives/paths';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../primitives/constants';
import { PERMISSIONS_FILENAME } from '../../services/config/defaults';
import type { PermissionConfig, PermissionRule } from './types';
import { PermissionConfigSchema } from './types';

const CURRENT_VERSION = 1;

/**
 * 获取配置文件的绝对路径
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
    return null;
  }
}

/**
 * 合并规则（项目级优先）
 */
function mergeRules(userRules: PermissionRule[], projectRules: PermissionRule[]): PermissionRule[] {
  const ruleMap = new Map<string, PermissionRule>();

  for (const rule of userRules) {
    ruleMap.set(rule.id, rule);
  }

  for (const rule of projectRules) {
    ruleMap.set(rule.id, rule);
  }

  return Array.from(ruleMap.values()).sort((a, b) => {
    if (a.source === 'project' && b.source !== 'project') return -1;
    if (a.source !== 'project' && b.source === 'project') return 1;
    return a.createdAt - b.createdAt;
  });
}

/**
 * 加载权限配置（支持多层级）
 *
 * 每次调用都从磁盘重新加载，确保始终读到最新状态。
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

  const mergedRules = loadedRules.reduce<PermissionRule[]>((acc, rules) => mergeRules(acc, rules), []);

  return {
    rules: mergedRules,
    version: CURRENT_VERSION,
  };
}

// ============================================================
// 导出内部函数供 rules.ts 使用
// ============================================================

export { createEmptyConfig, getPermissionsFilePath };
