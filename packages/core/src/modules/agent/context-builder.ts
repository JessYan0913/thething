import type { AgentDefinition, AgentExecutionContext, UIMessage } from './types';

/**
 * 构建 Sub Agent 的 System Prompt
 *
 * @param definition Agent 定义
 * @param context 执行上下文
 * @returns 完整的 System Prompt
 */
export function buildSubAgentPrompt(
  definition: AgentDefinition,
  _context: AgentExecutionContext,
): string {
  let prompt = definition.instructions;

  // 添加工具信息
  if (definition.tools?.length) {
    prompt += `\n\n## Available Tools\nYou can use: ${definition.tools.join(', ')}`;
  }
  if (definition.disallowedTools?.length) {
    prompt += `\n\n## Restricted Tools\nYou must NOT use: ${definition.disallowedTools.join(', ')}`;
  }

  // 添加输出指导
  if (definition.summarizeOutput !== false) {
    prompt += `\n\n## Output Guidelines
- Be concise and focused on actionable results
- State findings and conclusions directly with supporting evidence
- The parent agent knows the task context — no need to re-explain
- If more details are needed, the parent agent will ask follow-up questions`;
  }

  return prompt;
}

/**
 * 构建包含父上下文的 Prompt
 *
 * @param context 执行上下文
 * @param task 任务描述
 * @param maxMessages 最大消息数量
 * @returns 包含上下文的 Prompt
 */
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

/**
 * 消息摘要
 */
function summarizeMessages(messages: UIMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const textParts = msg.parts?.filter((p) => p.type === 'text') ?? [];
    const text = textParts
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join(' ')
      .slice(0, 200);
    if (text) {
      lines.push(`[${role}]: ${text}${text.length >= 200 ? '...' : ''}`);
    }
  }

  return lines.join('\n\n') || 'No recent conversation context available.';
}