import type { UIMessage } from 'ai';

export interface SubAgentContext {
  parentConversationId: string;
  subAgentName: string;
  parentMessages: UIMessage[];
  childMessages: UIMessage[];
  maxContextTokens?: number;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  error?: string;
}

export interface SubAgentResult {
  summary: string;
  fullOutput: UIMessage[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  durationMs: number;
  status: 'completed' | 'failed' | 'aborted';
  error?: string;
}

export interface ContextExtractionOptions {
  maxMessages?: number;
  includeSystemSummary?: boolean;
  includeToolCalls?: boolean;
}

function isUserMessage(msg: UIMessage): boolean {
  return msg.role === 'user';
}

function isAssistantMessage(msg: UIMessage): boolean {
  return msg.role === 'assistant';
}

function messageText(msg: UIMessage): string {
  return msg.parts
    .filter(
      (part: unknown): part is { type: 'text'; text: string } =>
        typeof part === 'object' && part !== null && 'type' in part && (part as { type: string }).type === 'text',
    )
    .map((part: { type: 'text'; text: string }) => part.text)
    .join('\n');
}

export function extractContextForSubAgent(parentMessages: UIMessage[], options?: ContextExtractionOptions): string {
  const { maxMessages = 6, includeSystemSummary = true, includeToolCalls = false } = options ?? {};

  const recentMessages = parentMessages.slice(-maxMessages);
  let context = '';

  if (includeSystemSummary) {
    const userMessages = parentMessages.filter(isUserMessage);
    const originalRequest = userMessages.length > 0 ? messageText(userMessages[0]) : '';
    context += `## Original User Request\n${originalRequest}\n\n`;
  }

  context += '## Conversation Context\n\n';

  recentMessages.forEach((msg, i) => {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    const text = messageText(msg);

    if (!text) return;

    if (msg.role === 'assistant' && !includeToolCalls) {
      const hasToolCalls = msg.parts.some((p: { type: string }) => p.type === 'tool-invocation');
      if (hasToolCalls) {
        context += `[${i}] ${roleLabel}: [Tool calls executed - results below]\n\n`;
        const toolResults = msg.parts.filter(
          (part: { type: string; output?: unknown }): part is { type: 'tool-result'; output: unknown } =>
            part.type === 'tool-result',
        ) as unknown as Array<{ type: 'tool-result'; output: unknown }>;
        for (const part of toolResults) {
          const output = typeof part.output === 'string' ? part.output : JSON.stringify(part.output).slice(0, 200);
          context += `  Tool result: ${output}\n\n`;
        }
        return;
      }
    }

    context += `[${i}] ${roleLabel}: ${text}\n\n`;
  });

  return context.trim();
}

export interface BuildSubAgentPromptOptions {
  instructions: string;
  task: string;
  parentContext?: string;
}

const SUB_AGENT_ROLE_PROMPT = `## Your Role
You are a sub-agent assisting a parent agent. Your output will be fed back to the parent agent's context, which has limited capacity.

## Output Guidelines
- Be concise and focused on actionable results
- Avoid verbose explanations, intermediate reasoning, or step-by-step narration
- State findings and conclusions directly with supporting evidence
- The parent agent already knows the task context — no need to re-explain
- If the parent agent needs more details, it will ask follow-up questions`;

export function buildSubAgentPrompt(options: BuildSubAgentPromptOptions): string {
  const { instructions, task, parentContext } = options;

  let prompt = '';

  prompt += instructions;
  prompt += '\n\n';

  prompt += SUB_AGENT_ROLE_PROMPT;
  prompt += '\n\n---\n\n';

  if (parentContext) {
    prompt += parentContext;
    prompt += '\n\n---\n\n';
  }

  prompt += `## Your Task\n\n${task}`;

  return prompt;
}

export function wrapSubAgentResult(
  childMessages: UIMessage[],
  status: 'completed' | 'failed' | 'aborted',
  error?: string,
): SubAgentResult {
  const assistantMessages = childMessages.filter((m) => m.role === 'assistant');
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];

  let summary = 'Sub-agent completed.';
  if (lastAssistantMessage) {
    const textParts = lastAssistantMessage.parts.filter(
      (part: unknown): part is { type: 'text'; text: string } =>
        typeof part === 'object' && part !== null && 'type' in part && (part as { type: string }).type === 'text',
    );
    const lastText = textParts[textParts.length - 1];
    if (lastText?.text) {
      summary = lastText.text;
    }
  }

  if (status === 'failed') {
    summary = `Sub-agent failed: ${error ?? 'Unknown error'}`;
  } else if (status === 'aborted') {
    summary = 'Sub-agent was aborted by the parent agent.';
  }

  const inputTokens = childMessages
    .filter((m) => m.role === 'user' || m.role === 'system')
    .reduce((sum, m) => sum + Math.ceil(messageText(m).length / 4), 0);

  const outputTokens = childMessages
    .filter((m) => m.role === 'assistant')
    .reduce((sum, m) => sum + Math.ceil(messageText(m).length / 4), 0);

  return {
    summary,
    fullOutput: childMessages,
    tokenUsage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    durationMs: 0,
    status,
    error,
  };
}

export function createSubAgentContext(
  parentConversationId: string,
  subAgentName: string,
  parentMessages: UIMessage[],
  maxContextTokens?: number,
): SubAgentContext {
  return {
    parentConversationId,
    subAgentName,
    parentMessages,
    childMessages: [],
    maxContextTokens,
    startedAt: Date.now(),
    finishedAt: null,
    status: 'running',
  };
}

export function finalizeSubAgentContext(
  ctx: SubAgentContext,
  childMessages: UIMessage[],
  status: 'completed' | 'failed' | 'aborted',
  error?: string,
): SubAgentContext {
  return {
    ...ctx,
    childMessages,
    finishedAt: Date.now(),
    status,
    error,
  };
}

export function getSubAgentDurationMs(ctx: SubAgentContext): number {
  if (ctx.finishedAt === null) {
    return Date.now() - ctx.startedAt;
  }
  return ctx.finishedAt - ctx.startedAt;
}