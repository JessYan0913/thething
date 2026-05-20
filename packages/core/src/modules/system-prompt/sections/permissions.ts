// ============================================================
// Permissions Section - 权限规则注入系统提示
// ============================================================
//
// modules.permissions 两级语义定义：
//
// Level 1 - 权限提示注入（Prompt Injection）:
//   modules.permissions === false → effectivePermissions = []
//   → createPermissionsSection 返回 null → 系统提示不包含权限规则
//   → Agent 不知道权限约束存在
//
// Level 2 - 底层安全拦截（Security Enforcement）:
//   tools 中的 checkPermissionRules 使用当前 AppContext 快照中的 permission rules
//   → 规则由 createContext → loadAll → loadPermissions 加载后注入 SessionState
//   → 独立于 modules.permissions 开关，始终生效
//   → 即使 modules.permissions=false，工具的审批决策仍检查权限规则
//
// 因此 modules.permissions=false 的含义是：
//   "不在系统提示中告诉 Agent 权限规则存在"
//   不是 "不执行权限规则"

import type { PermissionRule } from '../../permissions/types';
import type { SystemPromptSection } from '../types';

/**
 * 权限行为描述映射
 */
const BEHAVIOR_LABELS: Record<string, string> = {
  allow: '自动允许',
  ask: '需要确认',
  deny: '禁止',
};

/**
 * 将权限规则格式化为系统提示文本
 */
function formatPermissionsPrompt(rules: PermissionRule[]): string {
  if (rules.length === 0) return '';

  const lines: string[] = [
    '## 权限规则',
    '',
    '以下工具和路径的权限配置已经设定，你必须遵守这些约束：',
    '',
  ];

  // 按 behavior 分组
  const byBehavior: Record<string, PermissionRule[]> = {};
  for (const rule of rules) {
    const key = rule.behavior;
    if (!byBehavior[key]) byBehavior[key] = [];
    byBehavior[key].push(rule);
  }

  // deny 规则优先展示
  const order: string[] = ['deny', 'ask', 'allow'];
  for (const behavior of order) {
    const group = byBehavior[behavior];
    if (!group || group.length === 0) continue;

    lines.push(`### ${BEHAVIOR_LABELS[behavior] ?? behavior}`);
    for (const rule of group) {
      const sourceTag = rule.source ? ` (${rule.source})` : '';
      const patternTag = rule.pattern ? ` 匹配 "${rule.pattern}"` : '';
      lines.push(`- ${rule.toolName}${patternTag}${sourceTag}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 创建权限规则系统提示段
 *
 * 当 permissions 数组为空或 null 时返回 null content（跳过注入）。
 */
export function createPermissionsSection(
  permissions?: PermissionRule[],
): SystemPromptSection {
  const content = permissions?.length ? formatPermissionsPrompt(permissions) : null;

  return {
    name: 'permissions',
    content,
    cacheStrategy: 'session',
    priority: 35,
  };
}
