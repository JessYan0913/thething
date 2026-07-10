import type { AgentDefinition } from '../types';

/**
 * General-purpose Agent - 通用代理
 *
 * 特点：
 * - 全工具访问权限
 * - 作为复杂任务的默认回退
 */
export const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general-purpose',
  displayName: 'General Agent',
  model: 'inherit',
  tools: ['read_file', 'write_file', 'edit_file', 'grep', 'glob', 'bash', 'web_fetch'],
  source: 'builtin',
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
};
