/**
 * 权限规则加载器 + 持久化
 *
 * 配置文件路径:
 * - 用户全局: ~/.thething/permissions/permissions.json
 * - 项目级: 项目/.thething/permissions/permissions.json
 *
 * 优先级: 项目级 > 用户全局
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { nanoid } from 'nanoid';
import { parseJsonFile, getUserConfigDir, getProjectConfigDir, LoadingCache } from '../loading';
import { PERMISSIONS_FILENAME } from '../config/defaults';
import type { PermissionConfig, PermissionRule, RuleMatchResult } from './types';
import { PermissionConfigSchema } from './types';

const CURRENT_VERSION = 1;

let configuredBaseDir: string | null = null;

/**
 * Configure the base directory for permissions file.
 * Defaults to process.cwd().
 */
export function configurePermissionsBaseDir(dir: string): void {
  configuredBaseDir = dir;
}

// 使用 LoadingCache 替代独立的缓存变量
const permissionsCache = new LoadingCache<PermissionConfig>();

/**
 * 获取配置文件的绝对路径
 */
function getPermissionsFilePath(dir: string): string {
  return path.join(dir, PERMISSIONS_FILENAME);
}

/**
 * 确保配置目录存在
 */
async function ensurePermissionsDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // 目录已存在
  }
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
 * 加载权限配置（支持多层级）
 *
 * 加载顺序：
 * 1. 用户全局配置 (~/.thething/permissions/permissions.json)
 * 2. 项目级配置 (项目/.thething/permissions/permissions.json)
 *
 * 合并规则：项目级优先级高于用户级
 */
export async function loadRules(): Promise<PermissionConfig> {
  const cwd = configuredBaseDir || process.cwd();
  const cacheKey = `permissions:${cwd}`;

  // 检查缓存
  const cached = permissionsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const userDir = getUserConfigDir('permissions');
  const projectDir = getProjectConfigDir(cwd, 'permissions');

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
 * 同步加载（用于 needsApproval 中，避免异步问题）
 * 需要先调用 loadRules() 进行初始化
 */
export function loadRulesSync(): PermissionConfig {
  const cwd = configuredBaseDir || process.cwd();
  const cacheKey = `permissions:${cwd}`;

  const cached = permissionsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 返回空配置，避免在 needsApproval 中出错
  return createEmptyConfig();
}

/**
 * 保存配置到文件（项目级）
 */
async function saveConfig(config: PermissionConfig): Promise<void> {
  const cwd = configuredBaseDir || process.cwd();
  const projectDir = getProjectConfigDir(cwd, 'permissions');

  await ensurePermissionsDir(projectDir);
  const filePath = getPermissionsFilePath(projectDir);

  // 只保存项目级规则
  const projectRules = config.rules.filter(r => r.source === 'project' || !r.source);

  const configToSave: PermissionConfig = {
    rules: projectRules,
    version: CURRENT_VERSION,
  };

  await fs.writeFile(filePath, JSON.stringify(configToSave, null, 2), 'utf-8');

  // 更新缓存
  const cacheKey = `permissions:${cwd}`;
  permissionsCache.set(cacheKey, config);
}

/**
 * 添加新规则（保存到项目级）
 */
export async function saveRule(rule: Omit<PermissionRule, 'id' | 'createdAt' | 'source'>): Promise<PermissionRule> {
  const config = await loadRules();

  const newRule: PermissionRule = {
    ...rule,
    id: nanoid(),
    createdAt: Date.now(),
    source: 'project',
  };

  config.rules.push(newRule);
  await saveConfig(config);

  return newRule;
}

/**
 * 删除规则
 */
export async function removeRule(id: string): Promise<void> {
  const config = await loadRules();
  config.rules = config.rules.filter(r => r.id !== id);
  await saveConfig(config);
}

/**
 * 清除所有规则（仅清除项目级）
 */
export async function clearRules(): Promise<void> {
  const config = await loadRules();
  // 只清除项目级规则，保留用户级
  config.rules = config.rules.filter(r => r.source === 'user');
  await saveConfig(config);
}

/**
 * 检查规则是否匹配工具调用
 *
 * Bash 工具: pattern 匹配命令前缀（如 "git *" 匹配所有 git 命令）
 * 文件工具: pattern 匹配路径（如 "src/**" 匹配 src 下所有文件）
 */
export function matchRule(
  toolName: string,
  input: Record<string, unknown>,
): RuleMatchResult {
  const config = loadRulesSync();

  for (const rule of config.rules) {
    if (rule.toolName !== toolName) {
      continue;
    }

    // 无 pattern 的规则匹配所有调用
    if (!rule.pattern) {
      return { matched: true, rule };
    }

    // Bash 工具：匹配命令前缀
    if (toolName === 'bash') {
      const command = String(input.command || '');
      const pattern = rule.pattern;

      // "git *" 匹配所有 git 开头的命令
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1).trim();
        if (command.trim().startsWith(prefix)) {
          return { matched: true, rule };
        }
      }

      // 精确匹配
      if (command.trim() === pattern.trim()) {
        return { matched: true, rule };
      }
    }

    // 文件工具：匹配路径模式
    if (['read_file', 'edit_file', 'write_file'].includes(toolName)) {
      const filePath = String(input.filePath || '');
      const pattern = rule.pattern;

      // glob 模式匹配
      if (pattern.includes('*')) {
        // 简化的 glob 匹配
        const regex = new RegExp(
          pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\./g, '\\.')
        );
        if (regex.test(filePath)) {
          return { matched: true, rule };
        }
      }

      // 精确匹配或前缀匹配
      if (filePath === pattern || filePath.startsWith(pattern)) {
        return { matched: true, rule };
      }
    }
  }

  return { matched: false };
}

/**
 * 检查权限规则并返回行为
 * 用于 needsApproval 函数中
 */
export function checkPermissionRules(
  toolName: string,
  input: Record<string, unknown>,
): PermissionRule | null {
  const result = matchRule(toolName, input);
  return result.matched ? result.rule ?? null : null;
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
 */
export async function initPermissions(): Promise<void> {
  await loadRules();
}