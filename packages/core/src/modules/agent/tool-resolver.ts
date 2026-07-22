import type { AgentDefinition, AgentExecutionContext } from './types';

/**
 * 系统工具名称（硬编码，与 tools.ts 中的定义一致）
 */
const SYSTEM_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'bash',
  'grep', 'glob', 'web_fetch',
  'ask_user_question', 'skill', 'cron',
  'save_wiki', 'read_wiki_page',
  'agent', 'parallel_agent',
  'create_todos', 'update_todos', 'list_todos', 'delete_todos',
]);

/**
 * 子 Agent 禁用工具（无条件剔除，白名单也不能绕过）：
 * - agent / parallel_agent：设计上只允许一层子 Agent——子 Agent
 *   不能再派生子 Agent。嵌套防护完全由这里的结构性剔除保证，
 *   没有运行时深度计数。
 */
const SUB_AGENT_DENIED_TOOLS = new Set(['agent', 'parallel_agent']);

/**
 * 解析 Agent 可用的工具列表
 *
 * 过滤逻辑：
 * 0. 子 Agent 禁用工具（agent/parallel_agent，无条件剔除）
 * 1. tools 白名单（如指定了的话）
 * 2. connectors 开关（false 时过滤连接器工具）
 * 3. skills 开关（false 时过滤技能工具）
 * 4. mcp 开关（false 时过滤 MCP 工具）
 *
 * @param definition Agent 定义
 * @param context 执行上下文
 * @returns 活动工具名称列表（始终返回数组，空数组表示无可用工具）
 */
export function resolveToolsForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): string[] {
  const { tools: allowedTools, connectors = true, skills = true, mcp = true } = definition;
  const allToolNames = Object.keys(context.parentTools);

  // 0. 无条件剔除子 Agent 禁用工具（递归防护，不受白名单/开关影响）
  let filtered = allToolNames.filter((name) => !SUB_AGENT_DENIED_TOOLS.has(name));

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

  // 始终返回数组：返回 undefined 会让 SDK 视为"全部工具"，
  // 打穿第 0 步的递归防护
  return filtered;
}

/**
 * 判断是否为系统工具或 MCP 工具（非连接器工具）
 */
function isSystemOrMcpTool(name: string): boolean {
  return SYSTEM_TOOLS.has(name) || name.startsWith('mcp__');
}
