import type { AgentDefinition, AgentExecutionContext } from './types';

/**
 * 解析 Agent 可用的工具列表
 *
 * @param definition Agent 定义
 * @param context 执行上下文
 * @returns 活动工具名称列表，或 undefined（表示使用所有工具）
 */
export function resolveToolsForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): string[] | undefined {
  const { tools } = definition;

  // 如果没有定义 tools，则可以使用所有工具
  if (!tools?.length) {
    return undefined;
  }

  // 如果定义了 tools，按白名单过滤
  const availableToolNames = Object.keys(context.parentTools);

  // 如果 tools 包含 '*'，表示所有工具
  if (tools.includes('*')) {
    return undefined;
  }

  // 按 tools 白名单过滤
  const filtered = availableToolNames.filter((name) => tools.includes(name));

  return filtered.length > 0 ? filtered : undefined;
}