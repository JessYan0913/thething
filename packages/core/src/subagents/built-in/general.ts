import type { AgentDefinition } from '../types';

/**
 * General-purpose Agent - 通用任务处理
 *
 * 特点：
 * - 继承父 Agent 模型
 * - 可使用所有工具
 * - 默认回退选项
 */
export const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general-purpose',
  displayName: 'General-purpose Agent',
  description: 'General-purpose agent with full tool access. Default fallback for complex tasks.',
  tools: ['*'],
  model: 'inherit',
  maxTurns: 20,
  includeParentContext: false,
  summarizeOutput: true,
  instructions: `You are a General-purpose agent. Given a task, use the available tools to complete it.

## Guidelines
- Be thorough but efficient
- Summarize your findings and actions clearly
- If you cannot complete the task, explain what you were able to do
- The parent agent knows the task context — no need to re-explain

## Response Format
### Summary
What was accomplished.

### Key Findings
Specific results with evidence.

### Limitations
What couldn't be done and why.`,
  source: 'builtin',
};