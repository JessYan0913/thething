import type { AgentDefinition, AgentExecutionContext, UIMessage } from '../core/types';

export function buildSubAgentPrompt(
  definition: AgentDefinition,
  _context: AgentExecutionContext,
): string {
  let prompt = definition.instructions;

  if (definition.allowedTools?.length) {
    prompt += `\n\n## Available Tools\nYou can use: ${definition.allowedTools.join(', ')}`;
  }
  if (definition.disallowedTools?.length) {
    prompt += `\n\n## Restricted Tools\nYou must NOT use: ${definition.disallowedTools.join(', ')}`;
  }

  if (definition.summarizeOutput !== false) {
    prompt += `\n\n## Output Guidelines
- Be concise and focused on actionable results
- State findings and conclusions directly with supporting evidence
- The parent agent knows the task context — no need to re-explain
- If more details are needed, the parent agent will ask follow-up questions`;
  }

  return prompt;
}

export function buildContextPrompt(
  context: AgentExecutionContext,
  task: string,
  maxMessages: number = 6,
): string {
  const recentMessages = context.parentMessages.slice(-maxMessages);
  const summary = summarizeMessages(recentMessages);

  return `## Previous Conversation Context

${summary}

---

## New Task

${task}`;
}

function summarizeMessages(messages: UIMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const textParts = msg.parts?.filter((p) => p.type === 'text') ?? [];
    const text = textParts.map((p) => (p as { type: 'text'; text: string }).text).join(' ').slice(0, 200);
    if (text) {
      lines.push(`[${role}]: ${text}${text.length >= 200 ? '...' : ''}`);
    }
  }

  return lines.join('\n\n') || 'No recent conversation context available.';
}
