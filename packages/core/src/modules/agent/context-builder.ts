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

  // 添加输出指导（P0 交付物契约：以最终结论收尾，不返回过程叙述）
  prompt += `\n\n## Output Guidelines
- Be concise and focused on actionable results
- State findings and conclusions directly with supporting evidence
- END your reply with a "## Final Conclusion" section: state what was accomplished and the key evidence. This is the deliverable the parent agent reads — return the RESULT, not your process steps or tool call logs.
- The parent agent knows the task context — no need to re-explain
- If more details are needed, the parent agent will ask follow-up questions`;

  return prompt;
}

/**
 * 构建包含父上下文的 Prompt
 *
 * C-1（架构审查）：不再做无差别的机械截断。消息量与单条长度上限由调用方
 * 配置决定（默认 6 条 / 每条 200 字保守护栏）；一旦发生裁剪，在摘要里明确
 * 告知子 Agent 省略了多少上下文，让它据此决定是否向父级索取更多详情——
 * 系统只提供可用呈现，不替 LLM 判定"哪部分关键"。
 *
 * @param context 执行上下文
 * @param task 任务描述
 * @param maxMessages 最大消息数量
 * @param maxCharsPerMessage 单条消息摘要最大字符数
 * @returns 包含上下文的 Prompt
 */
export function buildContextPrompt(
  context: AgentExecutionContext,
  task: string,
  maxMessages: number = 6,
  maxCharsPerMessage: number = 200,
): string {
  const recentMessages = context.parentMessages.slice(-maxMessages);
  const omittedCount = context.parentMessages.length - recentMessages.length;
  const summary = summarizeMessages(recentMessages, maxCharsPerMessage);

  const omissionNote = omittedCount > 0
    ? `\n\n(父对话共 ${context.parentMessages.length} 条，此处仅展示最近 ${recentMessages.length} 条；更早的 ${omittedCount} 条未包含。如其中可能承载任务关键背景，请说明并请求父级提供。)`
    : '';

  return `## Previous Conversation Context

${summary}${omissionNote}

---

## New Task

${task}`;
}

/**
 * 消息摘要
 */
function summarizeMessages(messages: UIMessage[], maxCharsPerMessage = 200): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const textParts = msg.parts?.filter((p) => p.type === 'text') ?? [];
    const fullText = textParts
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join(' ');
    const text = fullText.slice(0, maxCharsPerMessage);
    if (text) {
      lines.push(`[${role}]: ${text}${fullText.length > maxCharsPerMessage ? '…' : ''}`);
    }
  }

  return lines.join('\n\n') || 'No recent conversation context available.';
}