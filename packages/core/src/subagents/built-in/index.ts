import type { AgentDefinition } from '../types';
import { globalAgentRegistry } from '../registry';
import { EXPLORE_AGENT } from './explore';
import { RESEARCH_AGENT } from './research';
import { PLAN_AGENT } from './plan';
import { GENERAL_AGENT } from './general';

// 导出所有内置 Agent 定义
export { EXPLORE_AGENT } from './explore';
export { RESEARCH_AGENT } from './research';
export { PLAN_AGENT } from './plan';
export { GENERAL_AGENT } from './general';

/**
 * 所有内置 Agent 定义列表
 */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  EXPLORE_AGENT,
  RESEARCH_AGENT,
  PLAN_AGENT,
  GENERAL_AGENT,
];

/**
 * 注册所有内置 Agent 到全局注册表
 *
 * 应在应用启动时调用：
 * ```typescript
 * import { registerBuiltinAgents } from '@the-thing/core/subagents';
 * registerBuiltinAgents();
 * ```
 */
export function registerBuiltinAgents(): void {
  for (const agent of BUILTIN_AGENTS) {
    globalAgentRegistry.register(agent);
  }

  console.log(`[AgentRegistry] Registered ${BUILTIN_AGENTS.length} builtin agents: ${BUILTIN_AGENTS.map(a => a.agentType).join(', ')}`);
}

/**
 * 获取内置 Agent 定义
 *
 * @param agentType Agent 类型
 * @returns Agent 定义或 undefined
 */
export function getBuiltinAgent(agentType: string): AgentDefinition | undefined {
  return BUILTIN_AGENTS.find(a => a.agentType === agentType);
}

/**
 * 检查是否为内置 Agent
 */
export function isBuiltinAgent(agentType: string): boolean {
  return BUILTIN_AGENTS.some(a => a.agentType === agentType);
}