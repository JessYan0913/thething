import type { AgentDefinition, AgentExecutionContext } from './types';

/**
 * 子 Agent 禁用工具（无条件剔除，白名单也不能绕过）：
 * - agent / parallel_agent：设计上只允许一层子 Agent——子 Agent
 *   不能再派生子 Agent。嵌套防护完全由这里的结构性剔除保证，
 *   没有运行时深度计数。
 */
const SUB_AGENT_DENIED_TOOLS = new Set(['agent', 'parallel_agent']);

/** 技能通路工具（skills 开关管辖） */
const SKILL_TOOLS = new Set(['skill', 'find_skills']);

export interface ToolFilterOptions {
  /** 工具白名单（只约束系统工具；MCP/connector 工具由能力开关控制） */
  tools?: string[];
  /** 是否可用连接器工具（默认 true） */
  connectors?: boolean;
  /** 是否可用技能工具（默认 true） */
  skills?: boolean;
  /** 是否可用 MCP 工具（默认 true） */
  mcp?: boolean;
  /**
   * 注册期确定的 connector 工具名集合（loadAllTools 填充）。
   * 工具分类不靠硬编码名单：mcp__ 前缀 = MCP，此集合 = connector，其余 = 系统工具。
   */
  connectorToolNames?: ReadonlySet<string>;
  /** 是否剔除 agent/parallel_agent（子 Agent 传 true，主 Agent 传 false） */
  denySubAgentTools?: boolean;
}

/**
 * 统一的工具过滤器（主 Agent 与子 Agent 共用）
 *
 * 过滤逻辑：
 * 0. denySubAgentTools 时无条件剔除 agent/parallel_agent
 * 1. tools 白名单（只作用于系统工具；MCP/connector 不受白名单约束）
 * 2. connectors 开关（false 时过滤连接器工具）
 * 3. skills 开关（false 时过滤 skill/find_skills）
 * 4. mcp 开关（false 时过滤 mcp__ 前缀工具）
 */
export function filterToolNames(allNames: string[], opts: ToolFilterOptions): string[] {
  const {
    tools: allowedTools,
    connectors = true,
    skills = true,
    mcp = true,
    connectorToolNames,
    denySubAgentTools = false,
  } = opts;

  const isMcp = (name: string) => name.startsWith('mcp__');
  const isConnector = (name: string) => connectorToolNames?.has(name) ?? false;
  const isSystem = (name: string) => !isMcp(name) && !isConnector(name);

  // 0. 无条件剔除子 Agent 禁用工具（递归防护，不受白名单/开关影响）
  let filtered = denySubAgentTools
    ? allNames.filter((name) => !SUB_AGENT_DENIED_TOOLS.has(name))
    : [...allNames];

  // 1. tools 白名单过滤：只约束系统工具。
  //    MCP/connector 工具由下方能力开关独立控制——否则白名单
  //    （内置 Agent 全是系统工具名）会把 MCP 工具结构性剥掉。
  if (allowedTools?.length && !allowedTools.includes('*')) {
    filtered = filtered.filter((name) => !isSystem(name) || allowedTools.includes(name));
  }

  // 2. connectors 开关：过滤连接器工具
  if (!connectors) {
    filtered = filtered.filter((name) => !isConnector(name));
  }

  // 3. skills 开关：过滤技能通路工具
  if (!skills) {
    filtered = filtered.filter((name) => !SKILL_TOOLS.has(name));
  }

  // 4. mcp 开关：过滤 MCP 工具（命名模式：mcp__server__tool）
  if (!mcp) {
    filtered = filtered.filter((name) => !isMcp(name));
  }

  return filtered;
}

/**
 * 解析子 Agent 可用的工具列表
 *
 * @param definition Agent 定义
 * @param context 执行上下文
 * @returns 活动工具名称列表（始终返回数组——返回 undefined 会让 SDK
 *          视为"全部工具"，打穿 agent/parallel_agent 的递归防护）
 */
export function resolveToolsForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): string[] {
  return filterToolNames(Object.keys(context.parentTools), {
    tools: definition.tools,
    connectors: definition.connectors,
    skills: definition.skills,
    mcp: definition.mcp,
    connectorToolNames: context.connectorToolNames,
    denySubAgentTools: true,
  });
}
