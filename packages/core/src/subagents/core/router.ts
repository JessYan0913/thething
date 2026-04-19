import type { AgentExecutionContext, AgentRouteDecision } from './types';
import { checkRecursionGuard } from '../execution/recursion-guard';
import { globalAgentRegistry } from './registry';
import type { AgentDefinition } from './types';

const BLOCKED_AGENT: AgentDefinition = {
  agentType: 'blocked',
  instructions: 'Agent execution blocked: maximum recursion depth exceeded.',
};

const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general',
  displayName: 'General Agent',
  description: 'General-purpose agent with shared tool pool. Default fallback.',
  allowedTools: ['*'],
  model: 'inherit',
  maxSteps: 20,
  includeParentContext: false,
  summarizeOutput: true,
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
};

const EXPLORE_KEYWORDS = ['find', 'locate', 'search', 'explore', 'where is', 'how do i find', 'look for', 'show me'];
const RESEARCH_KEYWORDS = ['research', 'investigate', 'analyze', 'deep dive', 'study', 'examine', 'research on'];
const CODE_KEYWORDS = ['write code', 'implement', 'create function', 'build', 'develop', 'program', 'coding', 'refactor'];

function isExploreTask(task: string): boolean {
  const lower = task.toLowerCase();
  return EXPLORE_KEYWORDS.some((kw) => lower.includes(kw));
}

function isResearchTask(task: string): boolean {
  const lower = task.toLowerCase();
  return RESEARCH_KEYWORDS.some((kw) => lower.includes(kw));
}

function isCodeTask(task: string): boolean {
  const lower = task.toLowerCase();
  return CODE_KEYWORDS.some((kw) => lower.includes(kw));
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

export function resolveAgentRoute(
  input: { agentType?: string; task: string },
  context: AgentExecutionContext,
): AgentRouteDecision {
  if (checkRecursionGuard({ recursionDepth: context.recursionDepth })) {
    return {
      type: 'general',
      definition: BLOCKED_AGENT,
      reason: 'Recursion depth exceeded',
    };
  }

  if (input.agentType) {
    const def = globalAgentRegistry.get(input.agentType);
    if (def) {
      return { type: 'named', definition: def, reason: 'Explicit' };
    }
    if (input.agentType === 'general') {
      return { type: 'general', definition: GENERAL_AGENT, reason: 'Explicit: general' };
    }
  }

  if (isExploreTask(input.task)) {
    const exploreDef = globalAgentRegistry.get('explore');
    if (exploreDef) {
      return { type: 'named', definition: exploreDef, reason: 'Auto: explore' };
    }
  }
  if (isResearchTask(input.task)) {
    const researchDef = globalAgentRegistry.get('research');
    if (researchDef) {
      return { type: 'named', definition: researchDef, reason: 'Auto: research' };
    }
  }
  if (isCodeTask(input.task)) {
    const codeDef = globalAgentRegistry.get('code');
    if (codeDef) {
      return { type: 'named', definition: codeDef, reason: 'Auto: code' };
    }
  }

  if (needsParentContext(input.task, context)) {
    const contextDef = globalAgentRegistry.get('context');
    if (contextDef) {
      return { type: 'context', definition: contextDef, reason: 'Needs context' };
    }
  }

  return { type: 'general', definition: GENERAL_AGENT, reason: 'Default' };
}
