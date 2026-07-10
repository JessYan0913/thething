import type { AgentDefinition, AgentExecutionContext } from './types';

/**
 * 系统工具名称（硬编码，与 tools.ts 中的定义一致）
 */
const SYSTEM_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'bash',
  'grep', 'glob', 'web_fetch',
  'ask_user_question', 'skill', 'cron',
  'save_wiki', 'read_wiki_page',
  'compact_tool_result',
  'agent', 'parallel_agent',
  'create_todos', 'update_todos', 'list_todos', 'delete_todos',
]);

/**
 * 解析 Agent 可用的工具列表
 *
 * 过滤逻辑：
 * 1. tools 白名单（如指定了的话）
 * 2. connectors 开关（false 时过滤连接器工具）
 * 3. skills 开关（false 时过滤技能工具）
 * 4. mcp 开关（false 时过滤 MCP 工具）
 *
 * @param definition Agent 定义
 * @param context 执行上下文
 * @returns 活动工具名称列表，或 undefined（表示使用所有工具）
 */
export function resolveToolsForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): string[] | undefined {
  const { tools: allowedTools, connectors = true, skills = true, mcp = true } = definition;
  const allToolNames = Object.keys(context.parentTools);

  // 如果没有定义白名单且所有开关都开启，使用所有工具
  if (!allowedTools?.length && connectors && skills && mcp) {
    return undefined;
  }

  // 从全量工具开始过滤
  let filtered = allToolNames;

  // 1. tools 白名单过滤
  if (allowedTools?.length) {
    if (allowedTools.includes('*')) {
      // 通配符：不过滤，但继续检查开关
    } else {
      filtered = filtered.filter((name) => allowedTools.includes(name));
    }
  }

  // 2. connectors 开关：过滤连接器工具（非系统工具 + 非 MCP 工具 = 连接器工具）
  if (!connectors) {
    filtered = filtered.filter((name) => isSystemOrMcpTool(name));
  }

  // 3. skills 开关：过滤 skill 工具
  if (!skills) {
    filtered = filtered.filter((name) => name !== 'skill');
  }

  // 4. mcp 开关：过滤 MCP 工具（命名模式：mcp__server__tool）
  if (!mcp) {
    filtered = filtered.filter((name) => !name.startsWith('mcp__'));
  }

  return filtered.length > 0 ? filtered : undefined;
}

/**
 * 判断是否为系统工具或 MCP 工具（非连接器工具）
 */
function isSystemOrMcpTool(name: string): boolean {
  return SYSTEM_TOOLS.has(name) || name.startsWith('mcp__');
}
