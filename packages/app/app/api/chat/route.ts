import { getServerRuntime, getServerContext } from '@/lib/runtime';
import { convertFileToText } from '@/lib/file-convert';
import {
  createAgent,
  generateConversationTitle,
  finalizeAgentRun,
  loadGlobalConfig,
  type SubAgentStreamWriter,
} from '@the-thing/core';
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// GET: Load messages for a conversation
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const rt = await getServerRuntime();
    const messages = rt.dataStore.messageStore.getMessagesByConversation(conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('[Chat API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

// POST: Stream chat response
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      message: UIMessage;
      conversationId: string;
      userId?: string;
      modelName?: string;
      agentType?: string;
    };

    const { message, conversationId, userId: messageUserId, modelName, agentType } = body;

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const context = await getServerContext();
    const store = context.runtime.dataStore;

    let existingMessages = store.messageStore.getMessagesByConversation(conversationId);
    const isFirstMessage = existingMessages.length === 0;

    const existingMessageIndex = existingMessages.findIndex((m: UIMessage) => m.id === message.id);
    if (existingMessageIndex >= 0) {
      existingMessages = existingMessages.slice(0, existingMessageIndex);
    } else {
      const lastUserMessageIndex = existingMessages.findLastIndex((m: UIMessage) => m.role === 'user');
      if (lastUserMessageIndex >= 0 && existingMessages[lastUserMessageIndex].id === message.id) {
        existingMessages = existingMessages.slice(0, lastUserMessageIndex);
      }
    }

    const messages: UIMessage[] = [...existingMessages, message];

    const writerRef: { current: SubAgentStreamWriter | null } = { current: null };
    const userId = messageUserId || 'default';

    const globalConfig = loadGlobalConfig();
    const {
      agent,
      sessionState,
      mcpRegistry,
      model,
      adjustedMessages,
      memoryBaseDir,
    } = await createAgent({
      context,
      conversationId,
      messages,
      userId,
      agentType,
      model: {
        apiKey: process.env.THETHING_API_KEY || globalConfig?.apiKey || '',
        baseURL: process.env.THETHING_BASE_URL || globalConfig?.baseURL || '',
        modelName: modelName || process.env.THETHING_MODEL || globalConfig?.modelAliases?.default?.model,
        includeUsage: true,
      },
      session: globalConfig?.contextLimit
        ? { maxContextTokens: globalConfig.contextLimit }
        : undefined,
    });

    const messagesWithAttachments = adjustedMessages ?? messages;

    // Convert unsupported file types (e.g. docx, xlsx, pptx) to text for the LLM.
    // We create a new array so original messages (with file parts) are preserved for storage.
    const llmMessages: UIMessage[] = await Promise.all(
      messagesWithAttachments.map(async (msg) => {
        if (msg.role !== 'user') return msg;
        const newParts: typeof msg.parts = [];
        let changed = false;
        for (const part of msg.parts) {
          if (part.type === 'file') {
            const fp = part as { mediaType: string; url: string; filename?: string };
            const text = await convertFileToText(fp.url, fp.mediaType);
            if (text !== null) {
              const label = fp.filename ? `[文件: ${fp.filename}]\n\n` : '';
              newParts.push({ type: 'text', text: label + text } as (typeof msg.parts)[number]);
              changed = true;
              continue;
            }
          }
          newParts.push(part);
        }
        return changed ? { ...msg, parts: newParts } : msg;
      })
    );

    console.log(
      `[LLM Input] ${llmMessages.length} messages:\n` +
        llmMessages
          .map((m, i) => {
            const partSummaries = m.parts.map((p) => {
              if (p.type === 'text') return `text(${(p as { text: string }).text.slice(0, 40)})`;
              if (p.type === 'file') {
                const fp = p as { mediaType?: string; filename?: string; url?: string };
                return `file(${fp.mediaType}, ${fp.filename ?? 'unnamed'}, url:${fp.url ? fp.url.slice(0, 30) + '...' : 'none'})`;
              }
              return `[${p.type}]`;
            });
            return `  [${i}] ${m.role}: ${partSummaries.join(' | ')}`;
          })
          .join('\n'),
    );

    const abortController = new AbortController();

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writerRef.current = writer as unknown as SubAgentStreamWriter;

        const agentStream = await createAgentUIStream({
          agent,
          uiMessages: llmMessages,
          abortSignal: abortController.signal,
          sendReasoning: true,
          onFinish: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
            try {
              const newAssistantMessages = completedMessages.slice(llmMessages.length);
              const messagesToSave = [...messages, ...newAssistantMessages];

              console.log(
                `[Storage] Saving ${messagesToSave.length} messages (${messages.length} original + ${newAssistantMessages.length} new)`,
              );

              const costSummary = sessionState.costTracker.getSummary();
              console.log(
                `[Cost] Total: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
              );

              await finalizeAgentRun({
                dataStore: store,
                messages: messagesToSave,
                conversationId,
                costTracker: sessionState.costTracker,
                mcpRegistry,
                model,
                isNewConversation: isFirstMessage,
                userId,
                memoryBaseDir,
              });
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
    return NextResponse.json({ error: 'Failed to process chat request' }, { status: 500 });
  }
}

// PATCH: Save messages
export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { conversationId: string; messages: UIMessage[] };
    if (!body.conversationId || !body.messages) {
      return NextResponse.json({ error: 'Missing conversationId or messages' }, { status: 400 });
    }
    const rt = await getServerRuntime();
    rt.dataStore.messageStore.saveMessages(body.conversationId, body.messages);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Chat API] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save messages' }, { status: 500 });
  }
}
