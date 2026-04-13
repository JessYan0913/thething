import type { AgentDefinition } from '../core/types';

export const GENERAL_AGENT: AgentDefinition = {
  agentType: 'general',
  displayName: 'General Agent',
  description: 'General-purpose agent with shared tool pool. Default fallback.',
  allowedTools: ['*'],
  disallowedTools: [],
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
