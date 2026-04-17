/**
 * 权限规则加载器 + 持久化
 *
 * 配置文件路径: .thething/permissions.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { nanoid } from 'nanoid';
import type { PermissionConfig, PermissionRule, RuleMatchResult } from './types';

const PERMISSIONS_FILE = '.thething/permissions.json';
const CURRENT_VERSION = 1;

// 内存缓存
let cachedConfig: PermissionConfig | null = null;

/**
 * 获取配置文件的绝对路径
 */
function getPermissionsFilePath(): string {
  // 使用当前工作目录
  return path.resolve(process.cwd(), PERMISSIONS_FILE);
}

/**
 * 确保配置目录存在
 */
async function ensurePermissionsDir(): Promise<void> {
  const dir = path.dirname(getPermissionsFilePath());
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // 目录已存在
  }
}

/**
 * 加载权限配置
 */
export async function loadRules(): Promise<PermissionConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const filePath = getPermissionsFilePath();

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const config = JSON.parse(content) as PermissionConfig;
    cachedConfig = config;
    return config;
  } catch {
    // 文件不存在或解析失败，返回空配置
    const emptyConfig: PermissionConfig = {
      rules: [],
      version: CURRENT_VERSION,
    };
    cachedConfig = emptyConfig;
    return emptyConfig;
  }
}

/**
 * 同步加载（用于 needsApproval 中，避免异步问题）
 * 需要先调用 loadRules() 进行初始化
 */
export function loadRulesSync(): PermissionConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  // 返回空配置，避免在 needsApproval 中出错
  return {
    rules: [],
    version: CURRENT_VERSION,
  };
}

/**
 * 保存配置到文件
 */
async function saveConfig(config: PermissionConfig): Promise<void> {
  await ensurePermissionsDir();
  const filePath = getPermissionsFilePath();
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  cachedConfig = config;
}

/**
 * 添加新规则
 */
export async function saveRule(rule: Omit<PermissionRule, 'id' | 'createdAt'>): Promise<PermissionRule> {
  const config = await loadRules();

  const newRule: PermissionRule = {
    ...rule,
    id: nanoid(),
    createdAt: Date.now(),
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
 * 清除所有规则
 */
export async function clearRules(): Promise<void> {
  const config = await loadRules();
  config.rules = [];
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
 * 初始化：加载规则到内存缓存
 * 应在应用启动时调用
 */
export async function initPermissions(): Promise<void> {
  await loadRules();
}