/**
 * 权限规则管理 - 规则匹配与 CRUD
 *
 * 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
 * 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。
 */

import * as fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { getProjectConfigDir } from '../../foundation/paths';
import type { PermissionConfig, PermissionRule, RuleMatchResult } from './types';
import {
  loadRules,
  loadRulesSync,
  clearPermissionsCache,
  getPermissionsFilePath,
} from './loader';

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
 * 加载权限配置（从 loader 导入）
 */
export { loadRules, loadRulesSync, clearPermissionsCache, initPermissions } from './loader';

/**
 * 保存配置到文件（项目级）
 *
 * @param config 配置对象
 * @param cwd 当前工作目录（默认 process.cwd()）
 */
async function saveConfig(config: PermissionConfig, cwd?: string): Promise<void> {
  const effectiveCwd = cwd ?? process.cwd();
  // 使用全局 configDirName
  const projectDir = getProjectConfigDir(effectiveCwd, 'permissions');

  await ensurePermissionsDir(projectDir);
  const filePath = getPermissionsFilePath(projectDir);

  // 只保存项目级规则
  const projectRules = config.rules.filter(r => r.source === 'project' || !r.source);

  const configToSave: PermissionConfig = {
    rules: projectRules,
    version: 1,
  };

  await fs.writeFile(filePath, JSON.stringify(configToSave, null, 2), 'utf-8');

  // 清除缓存
  clearPermissionsCache();
}

/**
 * 添加新规则（保存到项目级）
 *
 * @param rule 规则内容
 * @param cwd 当前工作目录（默认 process.cwd()）
 */
export async function saveRule(
  rule: Omit<PermissionRule, 'id' | 'createdAt' | 'source'>,
  cwd?: string,
): Promise<PermissionRule> {
  const config = await loadRules(cwd);

  const newRule: PermissionRule = {
    ...rule,
    id: nanoid(),
    createdAt: Date.now(),
    source: 'project',
  };

  config.rules.push(newRule);
  await saveConfig(config, cwd);

  return newRule;
}

/**
 * 删除规则
 *
 * @param id 规则 ID
 * @param cwd 当前工作目录（默认 process.cwd()）
 */
export async function removeRule(id: string, cwd?: string): Promise<void> {
  const config = await loadRules(cwd);
  config.rules = config.rules.filter(r => r.id !== id);
  await saveConfig(config, cwd);
}

/**
 * 清除所有规则（仅清除项目级）
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 */
export async function clearRules(cwd?: string): Promise<void> {
  const config = await loadRules(cwd);
  // 只清除项目级规则，保留用户级
  config.rules = config.rules.filter(r => r.source === 'user');
  await saveConfig(config, cwd);
}

/**
 * 检查规则是否匹配工具调用
 *
 * 改造说明：接收 rules 数组，不再需要 cwd 加载配置
 * 如果 rules 未提供，则自动加载（向后兼容）
 *
 * @param toolName 工具名称
 * @param input 工具输入
 * @param rules 权限规则列表（可选，未提供时自动加载）
 *
 * Bash 工具: pattern 匹配命令前缀（如 "git *" 匹配所有 git 契令）
 * 文件工具: pattern 匹配路径（如 "src/**" 匹配 src 下所有文件）
 */
export function matchRule(
  toolName: string,
  input: Record<string, unknown>,
  rules?: PermissionRule[],
): RuleMatchResult {
  // 向后兼容：如果 rules 未提供，自动加载
  const effectiveRules = rules ?? loadRulesSync().rules;

  for (const rule of effectiveRules) {
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
 *
 * 改造说明：接收 rules 数组，如果未提供则自动加载（向后兼容）
 *
 * @param toolName 工具名称
 * @param input 工具输入
 * @param rules 权限规则列表（可选）
 */
export function checkPermissionRules(
  toolName: string,
  input: Record<string, unknown>,
  rules?: PermissionRule[],
): PermissionRule | null {
  const result = matchRule(toolName, input, rules);
  return result.matched ? result.rule ?? null : null;
}