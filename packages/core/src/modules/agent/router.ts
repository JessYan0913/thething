import { AgentRegistry } from './registry';
import type { AgentDefinition, AgentExecutionContext, AgentRouteDecision } from './types';
import { logger } from '../../primitives/logger';

// ============================================================
// General-purpose Agent (Fallback)
// ============================================================

const GENERAL_PURPOSE_FALLBACK: AgentDefinition = {
  agentType: 'general-purpose',
  displayName: 'General Agent',
  tools: ['read_file', 'write_file', 'edit_file', 'grep', 'glob', 'bash', 'web_fetch'],
  model: 'inherit',
  instructions: `You are a General-purpose agent. Given a task, use the available tools to complete it.

## Guidelines
- Be thorough but efficient
- Summarize your findings and actions clearly
- If you cannot complete the task, explain what you were able to do

## Response Format
### Summary
What was accomplished.

### Key Findings
Specific results with evidence.

### Limitations
What couldn't be done and why.`,
  source: 'builtin',
};

// ============================================================
// Task Keywords for Auto-routing
// ============================================================

const EXPLORE_KEYWORDS = ['find', 'locate', 'search', 'explore', 'where is', 'how do i find', 'look for', 'show me'];
const RESEARCH_KEYWORDS = ['research', 'investigate', 'analyze', 'deep dive', 'study', 'examine', 'research on'];
const PLAN_KEYWORDS = ['plan', 'design', 'architecture', 'how should i', 'implement', 'strategy', 'approach'];

// ============================================================
// Task Classification Functions
// ============================================================

function isExploreTask(task: string): boolean {
  const lower = task.toLowerCase();
  return EXPLORE_KEYWORDS.some((kw) => lower.includes(kw));
}

function isResearchTask(task: string): boolean {
  const lower = task.toLowerCase();
  return RESEARCH_KEYWORDS.some((kw) => lower.includes(kw));
}

function isPlanTask(task: string): boolean {
  const lower = task.toLowerCase();
  return PLAN_KEYWORDS.some((kw) => lower.includes(kw));
}

function needsParentContext(task: string, context: AgentExecutionContext): boolean {
  if (task.toLowerCase().includes('continue') || task.toLowerCase().includes('follow up')) {
    return true;
  }
  if (context.parentMessages.length > 6) {
    return true;
  }
  return false;
}

// ============================================================
// Agent Route Resolution
// ============================================================

/**
 * 解析 Agent 路由
 *
 * 根据输入参数和上下文决定使用哪个 Agent。
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

  // 2. 自动路由（基于任务关键词）
  if (isExploreTask(input.task)) {
    const exploreDef = registry.get('explore');
    if (exploreDef) {
      return { type: 'named', definition: exploreDef, reason: 'Auto: explore keywords' };
    }
  }

  if (isResearchTask(input.task)) {
    const researchDef = registry.get('research');
    if (researchDef) {
      return { type: 'named', definition: researchDef, reason: 'Auto: research keywords' };
    }
  }

  if (isPlanTask(input.task)) {
    const planDef = registry.get('plan');
    if (planDef) {
      return { type: 'named', definition: planDef, reason: 'Auto: plan keywords' };
    }
  }

  // 3. 检查是否需要父上下文
  if (needsParentContext(input.task, context)) {
    const planDef = registry.get('plan');
    if (planDef) {
      return { type: 'named', definition: planDef, reason: 'Needs parent context' };
    }
  }

  // 4. 默认回退到 general-purpose
  return { type: 'general', definition: GENERAL_PURPOSE_FALLBACK, reason: 'Default fallback' };
}
