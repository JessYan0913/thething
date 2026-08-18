import { AgentRegistry } from './registry';
import { GENERAL_AGENT } from './built-in/general';
import type { AgentDefinition, AgentExecutionContext, AgentRouteDecision } from './types';
import { logger } from '../../primitives/logger';

// ============================================================
// General-purpose Agent (Fallback)
// ============================================================

// 复用内置 GENERAL_AGENT，消除重复定义
const GENERAL_PURPOSE_FALLBACK: AgentDefinition = GENERAL_AGENT;

// ============================================================
// Agent Route Resolution
// ============================================================

/**
 * 解析 Agent 路由
 *
 * 设计原则：系统只提供运行环境，不控制 LLM 的决策。
 * 关键词自动路由（explore/research/plan）与父上下文启发式均已移除——
 * 由 LLM 根据工具描述里的各子Agent 适用场景/工具/能力边界自行选择 agentType。
 *
 * @param input 输入参数（agentType 和 task）
 * @param context 执行上下文
 * @returns 路由决策
 */
export function resolveAgentRoute(
  input: { agentType?: string; task: string },
  context: AgentExecutionContext,
): AgentRouteDecision {
  const registry = context.agentRegistry ?? new AgentRegistry();

  // 嵌套防护由 resolveToolsForAgent 结构性保证（子 Agent 工具池中
  // 没有 agent/parallel_agent），路由层无需深度检查。

  // 1. 显式指定 AgentType
  if (input.agentType) {
    const def = registry.get(input.agentType);
    if (def) {
      return { type: 'named', definition: def, reason: 'Explicitly specified' };
    }
    // 如果指定了 'general-purpose' 或 'general'
    if (input.agentType === 'general-purpose' || input.agentType === 'general') {
      return { type: 'general', definition: GENERAL_PURPOSE_FALLBACK, reason: 'Explicit: general-purpose' };
    }
    // 未知类型，回退到 general
    logger.warn('Router', `Unknown agent type: ${input.agentType}, falling back to general-purpose`);
    return { type: 'general', definition: GENERAL_PURPOSE_FALLBACK, reason: `Unknown type: ${input.agentType}` };
  }

  // 2. 未指定 agentType → LLM 已通过工具描述获得各类型能力信息；
  //    若 LLM 决定委托会显式传 agentType，留空即表示走通用执行（general-purpose）。
  return { type: 'general', definition: GENERAL_PURPOSE_FALLBACK, reason: 'Default fallback' };
}
