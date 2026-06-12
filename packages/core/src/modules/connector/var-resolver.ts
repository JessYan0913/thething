// ============================================================
// Connector 变量解析器 — 提取 ${{ var_name }} 语法
// ============================================================
//
// 设计说明：
// 这份逻辑原本在 loader-internal.ts 和 registry.ts 中各有一份完全相同的实现。
// 提取到此处统一维护，避免重复修复漏改。

import { logger } from '../../primitives/logger';

/**
 * 解析 Connector YAML 中的变量声明。
 *
 * 1. 提取 `variables` 区域
 * 2. 递归替换整个 YAML 中的 ${{ var_name }} 引用
 *
 * @param obj 已解析的 YAML 对象
 * @returns 变量替换后的对象
 */
export function resolveConnectorVars(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const rawVars = (obj.variables ?? {}) as Record<string, string>;
  return walkAndReplace(obj, rawVars) as Record<string, unknown>;
}

const VAR_REF_RE = /\$\{\{(\s*\w+\s*)\}\}/g;

/**
 * 递归遍历值，将所有 `${{ var_name }}` 替换为变量值。
 * 未找到的变量名保留原样并记录警告。
 */
export function walkAndReplace(
  value: unknown,
  vars: Record<string, string>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(VAR_REF_RE, (match, varName) => {
      const trimmed = varName.trim();
      if (vars[trimmed] !== undefined) {
        return vars[trimmed];
      }
      logger.warn(
        'ConnectorVarResolver',
        'Variable reference \'${{ ' + trimmed + ' }}\' not found in variables — keeping as literal',
      );
      return match;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => walkAndReplace(item, vars));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = walkAndReplace(v, vars);
    }
    return result;
  }
  return value;
}
