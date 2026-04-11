import { createAgentPipeline } from '@/lib/agent-control/pipeline';
import { createDefaultStopConditions } from '@/lib/agent-control/stop-conditions';
import {
  generateConversationTitle,
  getMessagesByConversation,
  saveMessages,
  updateConversationTitle,
} from '@/lib/chat-store';
import { compactMessagesIfNeeded, estimateMessagesTokens } from '@/lib/compaction';
import { runCompactInBackground } from '@/lib/compaction/background-queue';
import { costTrackingMiddleware } from '@/lib/middleware/cost-tracking';
import { telemetryMiddleware } from '@/lib/middleware/telemetry';
import { createSessionState } from '@/lib/session-state/state';
import { createResearchAgent } from '@/lib/subagents';
import type { SubAgentStreamWriter } from '@/lib/subagents/agent-tool';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { bashTool, editFileTool, exaSearchTool, globTool, grepTool, readFileTool, writeFileTool } from '@/lib/tools';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  ToolLoopAgent,
  UIMessage,
  wrapLanguageModel,
} from 'ai';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
  includeUsage: true,
});

export const maxDuration = 30;

async function createChatAgent(
  conversationId: string,
  conversationMeta?: {
    messageCount: number;
    isNewConversation: boolean;
    conversationStartTime: number;
  },
  writerRef?: { current: SubAgentStreamWriter | null },
) {
  const { prompt, includedSections, estimatedTokens } = await buildSystemPrompt({
    includeProjectContext: true,
    conversationMeta: conversationMeta ?? undefined,
  });

  const sessionState = createSessionState(conversationId, {
    maxContextTokens: 128_000,
    compactThreshold: 25_000,
    maxBudgetUsd: 5.0,
    model: process.env.DASHSCOPE_MODEL,
  });

  const wrappedModel = wrapLanguageModel({
    model: dashscope(process.env.DASHSCOPE_MODEL!),
    middleware: [telemetryMiddleware(), costTrackingMiddleware(sessionState.costTracker)],
  });

  const tools = {
    web_search: exaSearchTool,
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
    bash: bashTool,
    grep: grepTool,
    glob: globTool,
    research: createResearchAgent({
      model: wrappedModel,
      tools: {
        web_search: exaSearchTool,
        read_file: readFileTool,
        grep: grepTool,
        glob: globTool,
      },
      maxSteps: 20,
      maxContextMessages: 10,
      writerRef,
    }),
  };

  const prepareStep = createAgentPipeline<typeof tools>({
    sessionState,
    maxSteps: 50,
    maxBudgetUsd: 5.0,
  });

  const stopWhen = createDefaultStopConditions<typeof tools>(sessionState.costTracker, {
    maxSteps: 50,
    denialTracker: sessionState.denialTracker,
    sessionState,
  });

  return {
    agent: new ToolLoopAgent({
      model: wrappedModel,
      instructions: prompt,
      tools,
      prepareStep,
      stopWhen,
      toolChoice: 'auto',
    }),
    sessionState,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return Response.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const messages = getMessagesByConversation(conversationId);
    return Response.json({ messages });
  } catch (error) {
    console.error('[Chat API] GET error:', error);
    return Response.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { message, conversationId }: {
      message: UIMessage;
      conversationId: string;
    } = await req.json();

    if (!conversationId) {
      return Response.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    let existingMessages = getMessagesByConversation(conversationId);
    const isFirstMessage = existingMessages.length === 0;

    const existingMessageIndex = existingMessages.findIndex((m) => m.id === message.id);
    if (existingMessageIndex >= 0) {
      existingMessages = existingMessages.slice(0, existingMessageIndex);
    } else {
      const lastUserMessageIndex = existingMessages.findLastIndex((m) => m.role === 'user');
      if (lastUserMessageIndex >= 0 && existingMessages[lastUserMessageIndex].id === message.id) {
        existingMessages = existingMessages.slice(0, lastUserMessageIndex);
      }
    }

    const messages: UIMessage[] = [...existingMessages, message];

    const { messages: compactedMessages, executed: compactionExecuted } = await compactMessagesIfNeeded(
      messages,
      conversationId,
    );

    const preCompactionTokens = estimateMessagesTokens(messages);
    const postCompactionTokens = estimateMessagesTokens(compactedMessages);
    console.log(`[Tokens] Pre: ${preCompactionTokens}, Post: ${postCompactionTokens}`);
    console.log(
      `[LLM Input] ${compactedMessages.length} messages:\n` +
        compactedMessages
          .map((m, i) => {
            const part = m.parts[0];
            const text = part?.type === 'text' ? part.text : `[${part?.type}]`;
            return `  [${i}] ${m.role}: ${text.replace(/\n/g, ' ').slice(0, 60)}${text.length > 60 ? '…' : ''}`;
          })
          .join('\n'),
    );

    const writerRef: { current: SubAgentStreamWriter | null } = { current: null };

    const { agent, sessionState } = await createChatAgent(
      conversationId,
      {
        messageCount: compactedMessages.length,
        isNewConversation: isFirstMessage,
        conversationStartTime: Date.now(),
      },
      writerRef,
    );

    const abortController = new AbortController();
    req.signal.addEventListener('abort', () => {
      sessionState.abort();
      abortController.abort();
    });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writerRef.current = writer as unknown as SubAgentStreamWriter;

        const agentStream = await createAgentUIStream({
          agent,
          uiMessages: compactedMessages,
          abortSignal: abortController.signal,
          sendReasoning: true,
          onFinish: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
            try {
              const newAssistantMessages = completedMessages.slice(compactedMessages.length);
              const messagesToSave = [...messages, ...newAssistantMessages];

              console.log(
                `[Storage] Saving ${messagesToSave.length} messages (${messages.length} original + ${newAssistantMessages.length} new)`,
              );
              console.log(
                `[Storage] Compaction was ${compactionExecuted ? 'executed' : 'not executed'}, but database receives ORIGINAL messages`,
              );

              await saveMessages(conversationId, messagesToSave);

              const costSummary = sessionState.costTracker.getSummary();
              console.log(
                `[Cost] Total: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
              );
              await sessionState.costTracker.persistToDB();

              if (isFirstMessage) {
                const title = await generateConversationTitle(completedMessages);
                updateConversationTitle(conversationId, title);
                console.log(`[Title Generated] ${conversationId}: ${title}`);
              }

              runCompactInBackground(messagesToSave, conversationId);
            } catch (err) {
              console.error('[Chat API] onFinish error:', err);
            }
          },
        });

        writer.merge(agentStream);
      },
      onError: (err) => String(err),
    });

    return createUIMessageStreamResponse({
      stream,
      headers: { 'X-Conversation-Id': conversationId },
    });
  } catch (error) {
    console.error('[Chat API] POST error:', error);
    return Response.json({ error: 'Failed to process chat request' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { conversationId, messages }: { conversationId: string; messages: UIMessage[] } = await req.json();

    if (!conversationId || !messages) {
      return Response.json({ error: 'Missing conversationId or messages' }, { status: 400 });
    }

    await saveMessages(conversationId, messages);

    return Response.json({ success: true });
  } catch (error) {
    console.error('[Chat API] PATCH error:', error);
    return Response.json({ error: 'Failed to save messages' }, { status: 500 });
  }
}