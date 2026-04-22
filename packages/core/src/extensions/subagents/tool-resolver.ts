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
  const { tools, disallowedTools } = definition;

  // 如果没有定义 tools，则可以使用所有工具（但需要过滤 disallowedTools）
  if (!tools?.length) {
    // 如果也没有 disallowedTools，则使用所有工具
    if (!disallowedTools?.length) {
      return undefined;
    }

    // 过滤掉 disallowedTools
    const availableToolNames = Object.keys(context.parentTools);
    return availableToolNames.filter((name) => !disallowedTools.includes(name));
  }

  // 如果定义了 tools，按白名单过滤
  const availableToolNames = Object.keys(context.parentTools);

  // 如果 tools 包含 '*'，表示所有工具
  if (tools.includes('*')) {
    if (!disallowedTools?.length) {
      return undefined;
    }
    return availableToolNames.filter((name) => !disallowedTools.includes(name));
  }

  // 按 tools 白名单过滤
  const filtered = availableToolNames.filter((name) => {
    // 检查白名单
    if (!tools.includes(name)) {
      return false;
    }
    // 检查黑名单
    if (disallowedTools?.includes(name)) {
      return false;
    }
    return true;
  });

  return filtered.length > 0 ? filtered : undefined;
}